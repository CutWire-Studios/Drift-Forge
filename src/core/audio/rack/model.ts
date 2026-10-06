// Finding things on a pedalboard, shared by the edits, the values, the graph Drift loads and the checks.
import { produce, type Draft } from "immer"
import { isSplit, type AudioRack, type ForgeDoc, type Pedal, type RackItem, type SplitBlock, type SplitLane } from "@/core/doc/types"

export const edit = (doc: ForgeDoc, recipe: (d: Draft<ForgeDoc>) => void): ForgeDoc => produce(doc, recipe)

export const emptyRack = (): AudioRack => ({ chain: [], modulators: [], routes: [] })
const EMPTY = emptyRack()

export function rackOf(doc: ForgeDoc): AudioRack {
  return doc.audio?.rack ?? EMPTY
}

export function rackDraft(d: Draft<ForgeDoc>): AudioRack {
  d.audio ??= { rack: emptyRack() }
  return d.audio.rack as AudioRack
}

const BUILTIN_IR = "builtin:"

/** The name of a built-in impulse response ("builtin:<name>"), or null for a recording asset. */
export const builtinIr = (ir: string): string | null => (ir.startsWith(BUILTIN_IR) ? ir.slice(BUILTIN_IR.length) : null)

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

export function pedalAt(rack: AudioRack, id: string): Pedal | undefined {
  const at = findItem(rack, id)
  return at && !isSplit(at.item) ? at.item : undefined
}

export function splitAt(rack: AudioRack, id: string): SplitBlock | undefined {
  const at = findItem(rack, id)
  return at && isSplit(at.item) ? at.item : undefined
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

export function slotList(rack: AudioRack, slot: Slot): { list: RackItem[]; depth: number } | undefined {
  if (slot.lane === null) return { list: rack.chain, depth: 0 }
  const found = findLane(rack, slot.lane)
  return found && { list: found.lane.chain, depth: found.depth }
}
