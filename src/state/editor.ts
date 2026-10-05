import { create } from "zustand"
import { temporal } from "zundo"
import { produce, type Draft } from "immer"
import * as rack from "@/audio/rack"
import type { Slot, ValuePath } from "@/audio/rack"
import * as ops from "@/doc/ops"
import type { ForgeAsset, ForgeDoc, InputValue, Modulator, ParamDef, ParamDefault, SplitBlock } from "@/doc/types"

export { literalFromParam, optionExposable, uniqueParamName } from "@/doc/ops"

export type ParamValue = ParamDefault

interface EditorState {
  localId: string | null
  doc: ForgeDoc | null
  selected: string[]
  /** What the preview's sliders are set to; Drift users set these per clip, so they aren't saved. */
  paramValues: Record<string, ParamValue>

  load(localId: string, doc: ForgeDoc): void
  update(recipe: (d: Draft<ForgeDoc>) => void): void
  /** Replaces the document wholesale (AI edits); one undo step. */
  replaceDoc(doc: ForgeDoc): void
  select(ids: string[]): void
  setParamValue(id: string, v: ParamValue): void
  resetParamValues(): void

  addNode(type: string, x: number, y: number): string
  removeNodes(ids: string[]): void
  duplicateNodes(ids: string[]): void
  moveNode(id: string, x: number, y: number): void
  connect(from: string, fromSocket: string, to: string, toSocket: string): boolean
  disconnect(edgeIds: string[]): void
  setInput(node: string, input: string, value: InputValue): void
  setData(node: string, key: string, value: unknown): void
  /** Returns why the input can't be exposed, or null once it is. */
  expose(node: string, input: string): string | null
  unexpose(node: string, input: string): void
  /** Exposes a curve, gradient, picture or region option. */
  exposeOption(node: string, option: string): string | null
  unexposeOption(node: string, option: string): void
  addParam(p: ParamDef): void
  updateParam(identifier: string, patch: Partial<ParamDef>): string | null
  removeParam(identifier: string): void
  moveParam(identifier: string, delta: number): void
  addAsset(a: ForgeAsset): void
  savePreset(name: string): void
  applyPreset(name: string): void
  deletePreset(name: string): void

  // Audio pedalboard. Ids returned are selected; errors come back as text, or null on success.
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

/** Every id selection can point at: graph nodes, rack items and modulators. */
function selectableIds(d: ForgeDoc): Set<string> {
  const ids = new Set(d.nodes.map((n) => n.id))
  if (d.audio) {
    for (const item of rack.allItems(d.audio.rack)) ids.add(item.id)
    for (const m of d.audio.rack.modulators) ids.add(m.id)
  }
  return ids
}

/** Records one undo step per burst of changes (a drag, a slider scrub), not one per frame. */
function burst<T>(handleSet: (state: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let open = false
  return (state: T) => {
    if (!open) handleSet(state)
    open = true
    clearTimeout(timer)
    timer = setTimeout(() => (open = false), 400)
  }
}

export const useEditor = create<EditorState>()(
  temporal(
    (set, get) => {
      const doc = () => get().doc!
      const put = (d: ForgeDoc) => {
        if (d !== get().doc) set({ doc: d })
      }
      return {
        localId: null,
        doc: null,
        selected: [],
        paramValues: {},

        load: (localId, d) => {
          set({ localId, doc: d, selected: [], paramValues: {} })
          useEditor.temporal.getState().clear()
        },
        update: (recipe) => {
          const d = get().doc
          if (d) set({ doc: produce(d, recipe) })
        },
        replaceDoc: (d) => {
          const ids = selectableIds(d)
          set({ doc: d, selected: get().selected.filter((id) => ids.has(id)) })
        },
        select: (ids) => set({ selected: ids }),
        setParamValue: (id, v) => set({ paramValues: { ...get().paramValues, [id]: v } }),
        resetParamValues: () => set({ paramValues: {} }),

        addNode: (type, x, y) => {
          const r = ops.addNode(doc(), type, x, y)
          if (ops.isOpError(r)) return ""
          set({ doc: r.doc, selected: [r.id] })
          return r.id
        },
        removeNodes: (ids) => {
          const d = ops.removeNodes(doc(), ids)
          const left = new Set(d.nodes.map((n) => n.id))
          set({ doc: d, selected: get().selected.filter((id) => left.has(id)) })
        },
        duplicateNodes: (ids) => {
          const r = ops.duplicateNodes(doc(), ids)
          if (!ops.isOpError(r)) set({ doc: r.doc, selected: r.ids })
        },
        moveNode: (id, x, y) => put(ops.moveNode(doc(), id, x, y)),
        connect: (from, fromSocket, to, toSocket) => {
          const r = ops.connect(doc(), from, fromSocket, to, toSocket)
          if (ops.isOpError(r)) return false
          put(r.doc)
          return true
        },
        disconnect: (edgeIds) => put(ops.disconnect(doc(), edgeIds)),
        setInput: (node, input, value) => put(ops.setInput(doc(), node, input, value)),
        setData: (node, key, value) => put(ops.setData(doc(), node, key, value)),
        expose: (node, input) => {
          const r = ops.expose(doc(), node, input)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        unexpose: (node, input) => put(ops.unexpose(doc(), node, input)),
        exposeOption: (node, option) => {
          const r = ops.exposeOption(doc(), node, option)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        unexposeOption: (node, option) => put(ops.unexposeOption(doc(), node, option)),
        addParam: (p) => put(ops.addParam(doc(), p)),
        updateParam: (identifier, patch) => {
          const r = ops.updateParam(doc(), identifier, patch)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          if (patch.identifier && patch.identifier !== identifier) {
            const values = { ...get().paramValues }
            if (identifier in values) {
              values[patch.identifier] = values[identifier]
              delete values[identifier]
              set({ paramValues: values })
            }
          }
          return null
        },
        removeParam: (identifier) => put(ops.removeParam(doc(), identifier)),
        moveParam: (identifier, delta) => put(ops.moveParam(doc(), identifier, delta)),
        addAsset: (a) => put(ops.addAsset(doc(), a)),
        savePreset: (name) => put(ops.savePreset(doc(), name, get().paramValues)),
        applyPreset: (name) => {
          const pr = get().doc?.presets?.find((p) => p.name === name)
          if (pr) set({ paramValues: structuredClone(pr.values) })
        },
        deletePreset: (name) => put(ops.deletePreset(doc(), name)),

        addPedal: (type, slot) => {
          const r = rack.addPedal(doc(), type, slot)
          if (ops.isOpError(r)) return ""
          set({ doc: r.doc, selected: [r.id] })
          return r.id
        },
        addSplit: (mode, lanes, slot) => {
          const r = rack.addSplit(doc(), mode, lanes, slot)
          if (ops.isOpError(r)) return ""
          set({ doc: r.doc, selected: [r.id] })
          return r.id
        },
        moveRackItem: (id, to) => {
          const r = rack.moveItem(doc(), id, to)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        removeRackItem: (id) => {
          const d = rack.removeItem(doc(), id)
          const ids = selectableIds(d)
          set({ doc: d, selected: get().selected.filter((s) => ids.has(s)) })
        },
        addLane: (splitId) => {
          const r = rack.addLane(doc(), splitId)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        removeLane: (splitId, laneId) => {
          const r = rack.removeLane(doc(), splitId, laneId)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        setLaneGain: (splitId, laneId, gain) => put(rack.setLaneGain(doc(), splitId, laneId, gain)),
        setSplitMode: (splitId, mode) => put(rack.setSplitMode(doc(), splitId, mode)),
        setCrossfade: (splitId, on) => {
          const r = rack.setCrossfade(doc(), splitId, on)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        setIr: (pedalId, ir) => put(rack.setIr(doc(), pedalId, ir)),
        setRackValue: (path, v) => put(rack.setValue(doc(), path, v)),
        exposeRackValue: (path) => {
          const r = rack.exposeValue(doc(), path)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        unexposeRackValue: (path) => put(rack.unexposeValue(doc(), path)),
        addModulator: (type) => {
          const r = rack.addModulator(doc(), type)
          if (ops.isOpError(r)) return ""
          set({ doc: r.doc, selected: [r.id] })
          return r.id
        },
        removeModulator: (id) => {
          set({ doc: rack.removeModulator(doc(), id), selected: get().selected.filter((s) => s !== id) })
        },
        setModulatorSource: (id, source) => put(rack.setModulatorSource(doc(), id, source)),
        setSteps: (id, steps) => put(rack.setSteps(doc(), id, steps)),
        addRoute: (from, to, knob, depth) => {
          const r = rack.addRoute(doc(), from, to, knob, depth)
          if (ops.isOpError(r)) return r.error
          put(r.doc)
          return null
        },
        removeRoute: (id) => put(rack.removeRoute(doc(), id)),
      }
    },
    {
      partialize: (s) => ({ doc: s.doc }),
      equality: (a, b) => a.doc === b.doc,
      handleSet: (handleSet) => burst(handleSet),
      limit: 200,
    },
  ),
)

export function currentDoc(): ForgeDoc {
  return useEditor.getState().doc!
}
