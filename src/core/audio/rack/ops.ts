// Pure edits on an audio document's pedalboard. The editor store and the AI tools both go through these.
import type { OpResult } from "@/core/edit/ops"
import { isSplit, type ForgeDoc, type KnobValue, type ModRoute, type Modulator, type Pedal, type RackItem, type SplitBlock, type SplitLane } from "@/core/doc/types"
import { uid } from "@/core/doc/util"
import { BLEND_KNOB, continuous, knobDefault, knobSpec, MAX_LANES, MAX_NODES, MAX_SPLIT_DEPTH, MAX_STEPS, modulatorSpec, pedalSpec, type KnobSpec } from "../pedals"
import { allItems, edit, findItem, pedalAt, rackDraft, rackOf, slotList, walkRack, type Slot } from "./model"
import { modulatorKind } from "./modulators"
import { setValue } from "./paths"

/** The space a new convolution pedal starts in. */
const DEFAULT_IR = "builtin:plate"

function insert(list: RackItem[], item: RackItem, index?: number) {
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, item)
}

const knobDefaults = (knobs: KnobSpec[]): Record<string, KnobValue> => Object.fromEntries(knobs.map((k) => [k.id, knobDefault(k)]))

// ---- items ------------------------------------------------------------------------------------

export function addPedal(doc: ForgeDoc, type: string, slot: Slot = { lane: null }): OpResult<{ id: string }> {
  const spec = pedalSpec(type)
  if (!spec) return { error: `There is no pedal called "${type}".` }
  if (allItems(rackOf(doc)).length >= MAX_NODES) return { error: `A pedalboard holds at most ${MAX_NODES} pedals.` }
  if (!slotList(rackOf(doc), slot)) return { error: "That lane doesn't exist." }
  const id = uid("p")
  const pedal: Pedal = { id, type, knobs: knobDefaults(spec.knobs) }
  if (spec.capabilities.impulseResponse) pedal.ir = DEFAULT_IR
  return {
    id,
    doc: edit(doc, (d) => {
      insert(slotList(rackDraft(d), slot)!.list, pedal, slot.index)
    }),
  }
}

/** Crossovers spread evenly on a log scale between 200 Hz and 5 kHz, as Drift defaults them. */
function defaultCrossovers(lanes: number): number[] {
  return Array.from({ length: lanes - 1 }, (_, i) => Math.round(200 * Math.pow(25, lanes === 2 ? 0.5 : i / (lanes - 2))))
}

function newLane(): SplitLane {
  return { id: uid("l"), gain: 1, chain: [] }
}

export function addSplit(doc: ForgeDoc, mode: SplitBlock["mode"], lanes = 2, slot: Slot = { lane: null }): OpResult<{ id: string }> {
  const target = slotList(rackOf(doc), slot)
  if (!target) return { error: "That lane doesn't exist." }
  if (target.depth >= MAX_SPLIT_DEPTH) return { error: "Splits nest at most two deep." }
  if (allItems(rackOf(doc)).length >= MAX_NODES) return { error: `A pedalboard holds at most ${MAX_NODES} pedals.` }
  const count = Math.max(2, Math.min(MAX_LANES, Math.round(lanes)))
  const id = uid("s")
  const split: SplitBlock = { id, type: "split", mode, lanes: Array.from({ length: count }, newLane) }
  if (mode === "bands") split.crossovers = defaultCrossovers(count)
  return {
    id,
    doc: edit(doc, (d) => {
      insert(slotList(rackDraft(d), slot)!.list, split, slot.index)
    }),
  }
}

function splitDepthBelow(item: RackItem): number {
  if (!isSplit(item)) return 0
  let deepest = 0
  for (const lane of item.lanes) for (const child of lane.chain) deepest = Math.max(deepest, splitDepthBelow(child))
  return deepest + 1
}

export function moveItem(doc: ForgeDoc, id: string, to: Slot): OpResult {
  const rack = rackOf(doc)
  const from = findItem(rack, id)
  const target = slotList(rack, to)
  if (!from || !target) return { error: "Nothing to move there." }
  if (to.lane !== null) {
    const ownLanes = new Set<string>()
    walkRack([from.item], (at) => isSplit(at.item) && at.item.lanes.forEach((l) => ownLanes.add(l.id)))
    if (ownLanes.has(to.lane)) return { error: "A split can't go inside itself." }
  }
  if (target.depth + splitDepthBelow(from.item) > MAX_SPLIT_DEPTH) return { error: "Splits nest at most two deep." }
  return {
    doc: edit(doc, (d) => {
      const r = rackDraft(d)
      const at = findItem(r, id)!
      at.list.splice(at.index, 1)
      // Moving later in the same list: the removal shifted the target index down by one.
      const list = slotList(r, to)!.list
      const index = to.index !== undefined && list === at.list && to.index > at.index ? to.index - 1 : to.index
      insert(list, at.item, index)
    }),
  }
}

export function removeItem(doc: ForgeDoc, id: string): ForgeDoc {
  const at = findItem(rackOf(doc), id)
  if (!at) return doc
  const gone = new Set<string>()
  walkRack([at.item], (x) => gone.add(x.item.id))
  return edit(doc, (d) => {
    const r = rackDraft(d)
    const found = findItem(r, id)!
    found.list.splice(found.index, 1)
    r.routes = r.routes.filter((route) => !gone.has(route.to))
    for (const m of r.modulators) if (m.source && gone.has(m.source)) m.source = "input"
  })
}

export function addLane(doc: ForgeDoc, splitId: string): OpResult {
  const at = findItem(rackOf(doc), splitId)
  if (!at || !isSplit(at.item)) return { error: "That isn't a split." }
  if (at.item.lanes.length >= MAX_LANES) return { error: `A split has at most ${MAX_LANES} lanes.` }
  return {
    doc: edit(doc, (d) => {
      const split = findItem(rackDraft(d), splitId)!.item as SplitBlock
      split.lanes.push(newLane())
      if (split.mode === "bands") split.crossovers = defaultCrossovers(split.lanes.length)
      if (split.lanes.length > 2) delete split.crossfade
    }),
  }
}

export function removeLane(doc: ForgeDoc, splitId: string, laneId: string): OpResult {
  const at = findItem(rackOf(doc), splitId)
  if (!at || !isSplit(at.item)) return { error: "That isn't a split." }
  if (at.item.lanes.length <= 2) return { error: "A split needs at least two lanes." }
  const lane = at.item.lanes.find((l) => l.id === laneId)
  if (!lane) return { error: "That lane doesn't exist." }
  const gone = new Set<string>()
  walkRack(lane.chain, (x) => gone.add(x.item.id))
  return {
    doc: edit(doc, (d) => {
      const r = rackDraft(d)
      const split = findItem(r, splitId)!.item as SplitBlock
      split.lanes = split.lanes.filter((l) => l.id !== laneId)
      if (split.mode === "bands") split.crossovers = (split.crossovers ?? []).slice(0, split.lanes.length - 1)
      r.routes = r.routes.filter((route) => !gone.has(route.to))
      for (const m of r.modulators) if (m.source && gone.has(m.source)) m.source = "input"
    }),
  }
}

export function setLaneGain(doc: ForgeDoc, splitId: string, laneId: string, gain: number): ForgeDoc {
  return edit(doc, (d) => {
    const at = findItem(rackDraft(d), splitId)
    const lane = at && isSplit(at.item) ? at.item.lanes.find((l) => l.id === laneId) : undefined
    if (lane) lane.gain = Math.max(0, Math.min(4, gain))
  })
}

export function setSplitMode(doc: ForgeDoc, splitId: string, mode: SplitBlock["mode"]): ForgeDoc {
  return edit(doc, (d) => {
    const at = findItem(rackDraft(d), splitId)
    if (!at || !isSplit(at.item) || at.item.mode === mode) return
    at.item.mode = mode
    if (mode === "bands") {
      at.item.crossovers = defaultCrossovers(at.item.lanes.length)
      delete at.item.crossfade
    } else {
      delete at.item.crossovers
    }
  })
}

export function setCrossfade(doc: ForgeDoc, splitId: string, on: boolean): OpResult {
  const at = findItem(rackOf(doc), splitId)
  if (!at || !isSplit(at.item)) return { error: "That isn't a split." }
  if (on && (at.item.mode !== "parallel" || at.item.lanes.length !== 2)) return { error: "Blending needs a parallel split with two lanes." }
  return {
    doc: edit(doc, (d) => {
      const split = findItem(rackDraft(d), splitId)!.item as SplitBlock
      if (on) {
        split.crossfade = true
        split.blend ??= BLEND_KNOB.default
      } else delete split.crossfade
    }),
  }
}

export function setIr(doc: ForgeDoc, pedalId: string, ir: string): ForgeDoc {
  return edit(doc, (d) => {
    const pedal = pedalAt(rackDraft(d), pedalId)
    if (pedal && pedalSpec(pedal.type)?.capabilities.impulseResponse) pedal.ir = ir
  })
}

// ---- modulators and routes --------------------------------------------------------------------

export function addModulator(doc: ForgeDoc, type: Modulator["type"]): OpResult<{ id: string }> {
  const spec = modulatorSpec(type)
  if (!spec) return { error: `There is no modulator called "${type}".` }
  const id = uid("m")
  const m: Modulator = { id, type, knobs: knobDefaults(spec.knobs), ...modulatorKind(type).initial() }
  return { id, doc: edit(doc, (d) => void rackDraft(d).modulators.push(m)) }
}

export function removeModulator(doc: ForgeDoc, id: string): ForgeDoc {
  return edit(doc, (d) => {
    const r = rackDraft(d)
    r.modulators = r.modulators.filter((m) => m.id !== id)
    r.routes = r.routes.filter((route) => route.from !== id)
  })
}

export function setModulatorSource(doc: ForgeDoc, id: string, source: string): ForgeDoc {
  if (source !== "input" && !findItem(rackOf(doc), source)) return doc
  return edit(doc, (d) => {
    const m = rackDraft(d).modulators.find((x) => x.id === id)
    if (m && modulatorKind(m.type).followsSource) m.source = source
  })
}

export function setSteps(doc: ForgeDoc, id: string, steps: number[]): ForgeDoc {
  const clean = steps.slice(0, MAX_STEPS).map((v) => Math.min(1, Math.max(0, v)))
  if (!clean.length) return doc
  return edit(doc, (d) => {
    const m = rackDraft(d).modulators.find((x) => x.id === id)
    if (m && modulatorKind(m.type).steps) m.steps = clean
  })
}

/** A modulator moving a knob. One route per modulator and knob: routing again changes its depth. */
export function addRoute(doc: ForgeDoc, from: string, to: string, knob: string, depth = 0.3): OpResult<{ id: string }> {
  const rack = rackOf(doc)
  if (!rack.modulators.some((m) => m.id === from)) return { error: "That modulator doesn't exist." }
  const pedal = pedalAt(rack, to)
  const spec = pedal && pedalSpec(pedal.type)
  const k = spec && knobSpec(spec, knob)
  if (!k) return { error: "That knob doesn't exist." }
  if (!continuous(k)) return { error: "Switches can't be modulated; pick a knob that turns." }
  const existing = rack.routes.find((r) => r.from === from && r.to === to && r.knob === k.id)
  if (existing) return { id: existing.id, doc: setValue(doc, { kind: "depth", route: existing.id }, depth) }
  const route: ModRoute = { id: uid("r"), from, to, knob: k.id, depth: Math.min(1, Math.max(-1, depth)) }
  return { id: route.id, doc: edit(doc, (d) => void rackDraft(d).routes.push(route)) }
}

export function removeRoute(doc: ForgeDoc, id: string): ForgeDoc {
  return edit(doc, (d) => {
    const r = rackDraft(d)
    r.routes = r.routes.filter((x) => x.id !== id)
  })
}
