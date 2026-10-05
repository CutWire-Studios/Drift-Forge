// Pure edits on an audio document's pedalboard, plus what Drift and the preview are built from:
// the "graph" object of audio-effect.json, and a signature that changes only when the graph's shape
// does. The editor store and the AI tools both go through these.
import { produce, type Draft } from "immer"
import { paramUsers, uniqueParamName, type OpResult } from "@/doc/ops"
import {
  isParamRef,
  isSplit,
  type AudioRack,
  type ForgeDoc,
  type KnobValue,
  type ModRoute,
  type Modulator,
  type ParamDef,
  type Pedal,
  type RackItem,
  type SplitBlock,
  type SplitLane,
} from "@/doc/types"
import { uid } from "@/doc/util"
import {
  BLEND_KNOB,
  CROSSOVER_KNOB,
  continuous,
  DEPTH_KNOB,
  knobSpec,
  MAX_LANES,
  MAX_NODES,
  MAX_SPLIT_DEPTH,
  MAX_STEPS,
  modulatorSpec,
  pedalSpec,
  type KnobSpec,
  type PedalSpec,
} from "./pedals"

const edit = (doc: ForgeDoc, recipe: (d: Draft<ForgeDoc>) => void): ForgeDoc => produce(doc, recipe)

export const emptyRack = (): AudioRack => ({ chain: [], modulators: [], routes: [] })
const EMPTY = emptyRack()

export function rackOf(doc: ForgeDoc): AudioRack {
  return doc.audio?.rack ?? EMPTY
}

// ---- finding things ---------------------------------------------------------------------------

export interface Located {
  item: RackItem
  /** the list holding it: the top chain or a lane's chain */
  list: RackItem[]
  index: number
  /** splits it sits inside */
  depth: number
  lane: SplitLane | null
}

/** Every item depth-first, a split before its lanes — the order Drift numbers graph nodes in. */
export function walkRack(chain: RackItem[], fn: (at: Located) => void, depth = 0, lane: SplitLane | null = null): void {
  chain.forEach((item, index) => {
    fn({ item, list: chain, index, depth, lane })
    if (isSplit(item)) for (const l of item.lanes) walkRack(l.chain, fn, depth + 1, l)
  })
}

export function findItem(rack: AudioRack, id: string): Located | undefined {
  let found: Located | undefined
  walkRack(rack.chain, (at) => {
    if (!found && at.item.id === id) found = at
  })
  return found
}

export function allItems(rack: AudioRack): RackItem[] {
  const out: RackItem[] = []
  walkRack(rack.chain, (at) => out.push(at.item))
  return out
}

function findLane(rack: AudioRack, laneId: string): { lane: SplitLane; depth: number } | undefined {
  let found: { lane: SplitLane; depth: number } | undefined
  walkRack(rack.chain, (at) => {
    if (found || !isSplit(at.item)) return
    const lane = at.item.lanes.find((l) => l.id === laneId)
    if (lane) found = { lane, depth: at.depth + 1 }
  })
  return found
}

/** Where an item goes: a lane's chain, or the top chain when `lane` is null. */
export interface Slot {
  lane: string | null
  index?: number
}

function slotList(rack: AudioRack, slot: Slot): { list: RackItem[]; depth: number } | undefined {
  if (slot.lane === null) return { list: rack.chain, depth: 0 }
  const found = findLane(rack, slot.lane)
  return found && { list: found.lane.chain, depth: found.depth }
}

function insert(list: RackItem[], item: RackItem, index?: number) {
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, item)
}

function nodeCount(rack: AudioRack): number {
  return allItems(rack).length
}

function knobDefault(k: KnobSpec): KnobValue {
  return k.scale === "toggle" ? k.default > 0.5 : k.default
}

function rackDraft(d: Draft<ForgeDoc>): AudioRack {
  d.audio ??= { rack: emptyRack() }
  return d.audio.rack as AudioRack
}

// ---- items ------------------------------------------------------------------------------------

export function addPedal(doc: ForgeDoc, type: string, slot: Slot = { lane: null }): OpResult<{ id: string }> {
  const spec = pedalSpec(type)
  if (!spec) return { error: `There is no pedal called "${type}".` }
  if (nodeCount(rackOf(doc)) >= MAX_NODES) return { error: `A pedalboard holds at most ${MAX_NODES} pedals.` }
  if (!slotList(rackOf(doc), slot)) return { error: "That lane doesn't exist." }
  const id = uid("p")
  const pedal: Pedal = { id, type, knobs: Object.fromEntries(spec.knobs.map((k) => [k.id, knobDefault(k)])) }
  if (type === "convolution") pedal.ir = "builtin:plate"
  return {
    id,
    doc: edit(doc, (d) => {
      const rack = rackDraft(d)
      insert(slotList(rack, slot)!.list, pedal, slot.index)
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
  if (nodeCount(rackOf(doc)) >= MAX_NODES) return { error: `A pedalboard holds at most ${MAX_NODES} pedals.` }
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
    const at = findItem(rackDraft(d), pedalId)
    if (at && !isSplit(at.item) && at.item.type === "convolution") at.item.ir = ir
  })
}

// ---- values: knobs, switches and anything that can become a slider -----------------------------

export type ValuePath =
  | { kind: "knob"; item: string; knob: string }
  | { kind: "bypass"; item: string }
  | { kind: "blend"; item: string }
  | { kind: "crossover"; item: string; index: number }
  | { kind: "modKnob"; mod: string; knob: string }
  | { kind: "depth"; route: string }

const BYPASS_KNOB: KnobSpec = { id: "bypass", label: "Bypass", min: 0, max: 1, default: 0, scale: "toggle", unit: "" }

export function valueSpec(rack: AudioRack, path: ValuePath): KnobSpec | undefined {
  switch (path.kind) {
    case "knob": {
      const at = findItem(rack, path.item)
      const spec = at && !isSplit(at.item) ? pedalSpec(at.item.type) : undefined
      return spec && knobSpec(spec, path.knob)
    }
    case "bypass":
      return BYPASS_KNOB
    case "blend":
      return BLEND_KNOB
    case "crossover":
      return CROSSOVER_KNOB
    case "modKnob": {
      const m = rack.modulators.find((x) => x.id === path.mod)
      const spec = m && modulatorSpec(m.type)
      return spec && knobSpec(spec, path.knob)
    }
    case "depth":
      return DEPTH_KNOB
  }
}

export function getValue(rack: AudioRack, path: ValuePath): KnobValue | undefined {
  switch (path.kind) {
    case "knob": {
      const at = findItem(rack, path.item)
      return at && !isSplit(at.item) ? at.item.knobs[path.knob] : undefined
    }
    case "bypass": {
      const at = findItem(rack, path.item)
      return at && !isSplit(at.item) ? (at.item.bypass ?? false) : undefined
    }
    case "blend": {
      const at = findItem(rack, path.item)
      return at && isSplit(at.item) ? (at.item.blend ?? BLEND_KNOB.default) : undefined
    }
    case "crossover": {
      const at = findItem(rack, path.item)
      return at && isSplit(at.item) ? at.item.crossovers?.[path.index] : undefined
    }
    case "modKnob":
      return rack.modulators.find((m) => m.id === path.mod)?.knobs[path.knob]
    case "depth":
      return rack.routes.find((r) => r.id === path.route)?.depth
  }
}

function putValue(rack: AudioRack, path: ValuePath, v: KnobValue) {
  const at = "item" in path ? findItem(rack, path.item) : undefined
  switch (path.kind) {
    case "knob":
      if (at && !isSplit(at.item)) at.item.knobs[path.knob] = v
      break
    case "bypass":
      if (at && !isSplit(at.item)) at.item.bypass = v
      break
    case "blend":
      if (at && isSplit(at.item)) at.item.blend = v
      break
    case "crossover":
      if (at && isSplit(at.item) && at.item.crossovers) at.item.crossovers[path.index] = v
      break
    case "modKnob": {
      const m = rack.modulators.find((x) => x.id === path.mod)
      if (m) m.knobs[path.knob] = v
      break
    }
    case "depth": {
      const r = rack.routes.find((x) => x.id === path.route)
      if (r) r.depth = v
      break
    }
  }
}

function clampTo(spec: KnobSpec, v: number | boolean): KnobValue {
  if (spec.scale === "toggle") return typeof v === "boolean" ? v : v >= 0.5
  const n = Math.min(spec.max, Math.max(spec.min, Number(v)))
  return spec.scale === "choice" ? Math.round(n) : n
}

/** Sets a fixed value. A control bound to a slider is changed through the slider instead. */
export function setValue(doc: ForgeDoc, path: ValuePath, v: number | boolean): ForgeDoc {
  const spec = valueSpec(rackOf(doc), path)
  const cur = getValue(rackOf(doc), path)
  if (!spec || isParamRef(cur)) return doc
  return edit(doc, (d) => putValue(rackDraft(d), path, clampTo(spec, v)))
}

function valueLabel(rack: AudioRack, path: ValuePath, spec: KnobSpec): string {
  if (path.kind === "depth") {
    const r = rack.routes.find((x) => x.id === path.route)
    const target = r && findItem(rack, r.to)
    const tSpec = target && !isSplit(target.item) ? pedalSpec(target.item.type) : undefined
    return `${tSpec ? `${tSpec.label} ` : ""}${(tSpec && knobSpec(tSpec, r!.knob)?.label) ?? ""} Movement`.trim()
  }
  if (path.kind === "modKnob") {
    const m = rack.modulators.find((x) => x.id === path.mod)
    return `${(m && modulatorSpec(m.type)?.label) ?? "Modulator"} ${spec.label}`
  }
  if (path.kind === "bypass") return "Off"
  return spec.label
}

/** Makes a control a slider people can set in Drift, starting at its current value. */
export function exposeValue(doc: ForgeDoc, path: ValuePath): OpResult<{ param: string }> {
  const rack = rackOf(doc)
  const spec = valueSpec(rack, path)
  const cur = getValue(rack, path)
  if (!spec || cur === undefined) return { error: "That control doesn't exist." }
  if (isParamRef(cur)) return { doc, param: cur.param }
  const label = valueLabel(rack, path, spec)
  const identifier = uniqueParamName(doc, label)
  const base = { identifier, displayName: label, min: spec.min, max: spec.max }
  const p: ParamDef =
    spec.scale === "toggle"
      ? { ...base, type: "bool", min: 0, max: 1, default: !!cur }
      : spec.scale === "choice"
        ? { ...base, type: "choice", options: [...(spec.options ?? [])], default: Math.round(Number(cur)) }
        : { ...base, type: "float", default: Number(cur), ...(spec.unit ? { ui: { unit: spec.unit } } : {}) }
  return {
    param: identifier,
    doc: edit(doc, (d) => {
      d.params.push(p)
      putValue(rackDraft(d), path, { param: identifier })
    }),
  }
}

/** Back to a fixed value (the slider's default); the slider goes too once nothing reads it. */
export function unexposeValue(doc: ForgeDoc, path: ValuePath): ForgeDoc {
  const cur = getValue(rackOf(doc), path)
  if (!isParamRef(cur)) return doc
  const p = doc.params.find((q) => q.identifier === cur.param)
  const literal: KnobValue = typeof p?.default === "boolean" ? p.default : Number(p?.default ?? 0)
  return edit(doc, (d) => {
    putValue(rackDraft(d), path, literal)
    if (!paramUsers(d as ForgeDoc, cur.param)) d.params = d.params.filter((q) => q.identifier !== cur.param)
  })
}

// ---- modulators and routes --------------------------------------------------------------------

export function addModulator(doc: ForgeDoc, type: Modulator["type"]): OpResult<{ id: string }> {
  const spec = modulatorSpec(type)
  if (!spec) return { error: `There is no modulator called "${type}".` }
  const id = uid("m")
  const m: Modulator = { id, type, knobs: Object.fromEntries(spec.knobs.map((k) => [k.id, knobDefault(k)])) }
  if (type === "steps") m.steps = [1, 0.25, 0.75, 0, 0.5, 1, 0.25, 0.5]
  if (type === "envelope") m.source = "input"
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
    if (m?.type === "envelope") m.source = source
  })
}

export function setSteps(doc: ForgeDoc, id: string, steps: number[]): ForgeDoc {
  const clean = steps.slice(0, MAX_STEPS).map((v) => Math.min(1, Math.max(0, v)))
  if (!clean.length) return doc
  return edit(doc, (d) => {
    const m = rackDraft(d).modulators.find((x) => x.id === id)
    if (m?.type === "steps") m.steps = clean
  })
}

/** A modulator moving a knob. One route per modulator and knob: routing again changes its depth. */
export function addRoute(doc: ForgeDoc, from: string, to: string, knob: string, depth = 0.3): OpResult<{ id: string }> {
  const rack = rackOf(doc)
  if (!rack.modulators.some((m) => m.id === from)) return { error: "That modulator doesn't exist." }
  const at = findItem(rack, to)
  const spec = at && !isSplit(at.item) ? pedalSpec(at.item.type) : undefined
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

// ---- what Drift and the preview are built from ---------------------------------------------------

/** Where an impulse response lives inside the package, and in the preview's staged files. */
export function irPath(doc: ForgeDoc, ir: string): string {
  if (ir.startsWith("builtin:")) return `ir/${ir.slice(8)}.wav`
  const asset = doc.assets.find((a) => a.id === ir)
  return `ir/${asset ? asset.id : ir}.wav`
}

function knobJson(v: KnobValue): unknown {
  return isParamRef(v) ? { param: v.param } : typeof v === "boolean" ? (v ? 1 : 0) : v
}

/** The "graph" object of audio-effect.json, exactly as Drift's AudioGraph parser reads it. */
export function graphJson(doc: ForgeDoc): Record<string, unknown> {
  const rack = rackOf(doc)
  const node = (item: RackItem): Record<string, unknown> => {
    if (isSplit(item)) {
      const out: Record<string, unknown> = { id: item.id, type: "split", mode: item.mode }
      if (item.crossfade) out.crossfade = true
      if (item.blend !== undefined) out.blend = knobJson(item.blend)
      if (item.mode === "bands" && item.crossovers) out.crossovers = item.crossovers.map(knobJson)
      out.lanes = item.lanes.map((l) => ({ gain: l.gain, chain: l.chain.map(node) }))
      return out
    }
    const out: Record<string, unknown> = {
      id: item.id,
      type: item.type,
      knobs: Object.fromEntries(Object.entries(item.knobs).map(([k, v]) => [k, knobJson(v)])),
    }
    if (item.bypass !== undefined && item.bypass !== false) out.bypass = knobJson(item.bypass)
    if (item.ir) out.ir = irPath(doc, item.ir)
    const routes = rack.routes.filter((r) => r.to === item.id)
    if (routes.length) {
      const mod: Record<string, unknown[]> = {}
      for (const r of routes) (mod[r.knob] ??= []).push({ from: r.from, depth: knobJson(r.depth) })
      out.mod = mod
    }
    return out
  }
  const graph: Record<string, unknown> = { version: 1 }
  if (rack.modulators.length) {
    graph.modulators = rack.modulators.map((m) => {
      const out: Record<string, unknown> = {
        id: m.id,
        type: m.type,
        knobs: Object.fromEntries(Object.entries(m.knobs).map(([k, v]) => [k, knobJson(v)])),
      }
      if (m.type === "steps") out.steps = m.steps ?? [1]
      if (m.type === "envelope" && m.source && m.source !== "input") out.source = m.source
      return out
    })
  }
  graph.chain = rack.chain.map(node)
  return graph
}

/**
 * Changes whenever the graph Drift would build changes shape, and not when only a fixed value
 * does: those the preview pushes into the running graph instead of rebuilding it (which would cut
 * every tail). Parameter defaults are excluded for the same reason.
 */
export function rackSignature(doc: ForgeDoc): string {
  const strip = (v: KnobValue) => (isParamRef(v) ? v : 0)
  const shape = (item: RackItem): unknown =>
    isSplit(item)
      ? [item.id, item.mode, !!item.crossfade, item.blend === undefined ? null : strip(item.blend), (item.crossovers ?? []).map(strip), item.lanes.map((l) => l.chain.map(shape))]
      : [item.id, item.type, item.ir ?? null, Object.entries(item.knobs).map(([k, v]) => [k, strip(v)]), strip(item.bypass ?? false)]
  const rack = rackOf(doc)
  return JSON.stringify([
    doc.params.map((p) => [p.identifier, p.type]),
    rack.chain.map(shape),
    rack.modulators.map((m) => [m.id, m.type, m.source ?? null, (m.steps ?? []).length, Object.entries(m.knobs).map(([k, v]) => [k, strip(v)])]),
    rack.routes.map((r) => [r.from, r.to, r.knob, strip(r.depth)]),
  ])
}

/** Problems Drift would reject the graph for, in words. Empty when it will load. */
export function validateRack(doc: ForgeDoc): string[] {
  const rack = rackOf(doc)
  const errors: string[] = []
  const params = new Set(doc.params.map((p) => p.identifier))
  const ids = new Set<string>()
  const checkValue = (v: KnobValue | undefined, where: string) => {
    if (isParamRef(v) && !params.has(v.param)) errors.push(`${where} uses a slider that no longer exists.`)
  }
  let count = 0
  walkRack(rack.chain, ({ item, depth }) => {
    count++
    if (ids.has(item.id)) errors.push(`Two pedals share the id ${item.id}.`)
    ids.add(item.id)
    if (isSplit(item)) {
      if (depth >= MAX_SPLIT_DEPTH) errors.push("Splits nest at most two deep.")
      if (item.lanes.length < 2 || item.lanes.length > MAX_LANES) errors.push(`A split needs 2 to ${MAX_LANES} lanes.`)
      if (item.crossfade && (item.mode !== "parallel" || item.lanes.length !== 2)) errors.push("Blending needs a parallel split with two lanes.")
      if (item.mode === "bands" && (item.crossovers?.length ?? 0) !== item.lanes.length - 1) errors.push("A band split needs one crossover per lane boundary.")
      checkValue(item.blend, "A split")
      item.crossovers?.forEach((c) => checkValue(c, "A crossover"))
      return
    }
    const spec = pedalSpec(item.type)
    if (!spec) {
      errors.push(`Drift has no pedal called "${item.type}".`)
      return
    }
    for (const [k, v] of Object.entries(item.knobs)) {
      if (!knobSpec(spec, k)) errors.push(`${spec.label} has no knob "${k}".`)
      checkValue(v, spec.label)
    }
    checkValue(item.bypass, spec.label)
    if (item.type === "convolution") {
      if (!item.ir) errors.push("A convolution reverb needs an impulse response.")
      else if (!item.ir.startsWith("builtin:") && !doc.assets.some((a) => a.id === item.ir)) errors.push("A convolution reverb's impulse response is missing.")
    }
  })
  if (count > MAX_NODES) errors.push(`A pedalboard holds at most ${MAX_NODES} pedals.`)
  const mods = new Set(rack.modulators.map((m) => m.id))
  for (const m of rack.modulators) {
    if (!modulatorSpec(m.type)) errors.push(`Drift has no modulator called "${m.type}".`)
    if (m.type === "steps" && (!m.steps?.length || m.steps.length > MAX_STEPS)) errors.push(`A step sequencer has 1 to ${MAX_STEPS} steps.`)
    if (m.source && m.source !== "input" && !ids.has(m.source)) errors.push("An envelope follower listens to a pedal that's gone.")
    for (const v of Object.values(m.knobs)) checkValue(v, "A modulator")
  }
  for (const r of rack.routes) {
    if (!mods.has(r.from)) errors.push("A modulation route comes from a modulator that's gone.")
    const at = findItem(rack, r.to)
    const spec: PedalSpec | undefined = at && !isSplit(at.item) ? pedalSpec(at.item.type) : undefined
    const k = spec && knobSpec(spec, r.knob)
    if (!k) errors.push("A modulation route goes to a knob that's gone.")
    else if (!continuous(k)) errors.push(`${spec!.label}'s ${k.label} is a switch and can't be modulated.`)
    checkValue(r.depth, "A modulation route")
  }
  return [...new Set(errors)]
}

/**
 * The legacy processor a document is, when it is exactly one classic pedal with every knob a slider
 * of the same name (what schema-1 documents migrate to). Those keep exporting in the old format,
 * so they still load in Drift 0.7.x.
 */
export function legacyProcessorFor(doc: ForgeDoc): string | null {
  const rack = rackOf(doc)
  if (rack.chain.length !== 1 || rack.modulators.length || rack.routes.length) return null
  const item = rack.chain[0]
  if (isSplit(item) || !item.type.startsWith("classic.") || (item.bypass !== undefined && item.bypass !== false)) return null
  const bound = Object.values(item.knobs)
  if (bound.length === 0 || !bound.every(isParamRef)) return null
  const names = bound.map((v) => (v as { param: string }).param)
  const spec = pedalSpec(item.type)!
  for (const [k, v] of Object.entries(item.knobs)) {
    const name = (v as { param: string }).param
    if (name !== k && !knobSpec(spec, k)?.aliases?.includes(name)) return null
  }
  if (doc.params.length !== names.length || !doc.params.every((p) => names.includes(p.identifier))) return null
  return item.type.slice("classic.".length)
}
