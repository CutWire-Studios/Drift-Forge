import * as rack from "@/core/audio/rack"
import type { Slot, ValuePath } from "@/core/audio/rack"
import { isOpError, type OpResult } from "@/core/edit/ops"
import type { ForgeDoc, Modulator, SplitBlock } from "@/core/doc/types"
import { selectableIds } from "./selection"

/** Audio pedalboard. Ids returned are selected; errors come back as text, or null on success. */
export interface RackActions {
  addPedal(type: string, slot?: Slot): string
  addSplit(mode: SplitBlock["mode"], lanes?: number, slot?: Slot): string
  moveRackItem(id: string, to: Slot): string | null
  removeRackItem(id: string): void
  addLane(splitId: string): string | null
  removeLane(splitId: string, laneId: string): string | null
  setLaneGain(splitId: string, laneId: string, gain: number): void
  setSplitMode(splitId: string, mode: SplitBlock["mode"]): void
  setCrossfade(splitId: string, on: boolean): string | null
  setIr(pedalId: string, ir: string): void
  setRackValue(path: ValuePath, v: number | boolean): void
  exposeRackValue(path: ValuePath): string | null
  unexposeRackValue(path: ValuePath): void
  addModulator(type: Modulator["type"]): string
  removeModulator(id: string): void
  setModulatorSource(id: string, source: string): void
  setSteps(id: string, steps: number[]): void
  addRoute(from: string, to: string, knob: string, depth?: number): string | null
  removeRoute(id: string): void
}

interface StoreTools {
  set(partial: { doc?: ForgeDoc; selected?: string[] }): void
  get(): { selected: string[] }
  doc(): ForgeDoc
  put(d: ForgeDoc): void
}

export function rackActions({ set, get, doc, put }: StoreTools): RackActions {
  const commit = (r: OpResult): string | null => {
    if (isOpError(r)) return r.error
    put(r.doc)
    return null
  }
  const addSelected = (r: OpResult<{ id: string }>): string => {
    if (isOpError(r)) return ""
    set({ doc: r.doc, selected: [r.id] })
    return r.id
  }
  return {
    addPedal: (type, slot) => addSelected(rack.addPedal(doc(), type, slot)),
    addSplit: (mode, lanes, slot) => addSelected(rack.addSplit(doc(), mode, lanes, slot)),
    moveRackItem: (id, to) => commit(rack.moveItem(doc(), id, to)),
    removeRackItem: (id) => {
      const d = rack.removeItem(doc(), id)
      const ids = selectableIds(d)
      set({ doc: d, selected: get().selected.filter((s) => ids.has(s)) })
    },
    addLane: (splitId) => commit(rack.addLane(doc(), splitId)),
    removeLane: (splitId, laneId) => commit(rack.removeLane(doc(), splitId, laneId)),
    setLaneGain: (splitId, laneId, gain) => put(rack.setLaneGain(doc(), splitId, laneId, gain)),
    setSplitMode: (splitId, mode) => put(rack.setSplitMode(doc(), splitId, mode)),
    setCrossfade: (splitId, on) => commit(rack.setCrossfade(doc(), splitId, on)),
    setIr: (pedalId, ir) => put(rack.setIr(doc(), pedalId, ir)),
    setRackValue: (path, v) => put(rack.setValue(doc(), path, v)),
    exposeRackValue: (path) => commit(rack.exposeValue(doc(), path)),
    unexposeRackValue: (path) => put(rack.unexposeValue(doc(), path)),
    addModulator: (type) => addSelected(rack.addModulator(doc(), type)),
    removeModulator: (id) => {
      set({ doc: rack.removeModulator(doc(), id), selected: get().selected.filter((s) => s !== id) })
    },
    setModulatorSource: (id, source) => put(rack.setModulatorSource(doc(), id, source)),
    setSteps: (id, steps) => put(rack.setSteps(doc(), id, steps)),
    addRoute: (from, to, knob, depth) => commit(rack.addRoute(doc(), from, to, knob, depth)),
    removeRoute: (id) => put(rack.removeRoute(doc(), id)),
  }
}
