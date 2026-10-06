// Values: knobs, switches and anything that can become a slider, addressed by a ValuePath. Each
// kind of path says once how to find its spec, read it, write it and name it.
import { paramUsers, uniqueParamName, type OpResult } from "@/core/edit/ops"
import { isParamRef, type AudioRack, type ForgeDoc, type KnobValue, type ParamDef } from "@/core/doc/types"
import { BLEND_KNOB, CROSSOVER_KNOB, DEPTH_KNOB, knobSpec, modulatorSpec, pedalSpec, type KnobScale, type KnobSpec } from "../pedals"
import { edit, pedalAt, rackDraft, rackOf, splitAt } from "./model"

export type ValuePath =
  | { kind: "knob"; item: string; knob: string }
  | { kind: "bypass"; item: string }
  | { kind: "blend"; item: string }
  | { kind: "crossover"; item: string; index: number }
  | { kind: "modKnob"; mod: string; knob: string }
  | { kind: "depth"; route: string }

type PathKind = ValuePath["kind"]
type PathOf<K extends PathKind> = Extract<ValuePath, { kind: K }>

interface PathStrategy<K extends PathKind> {
  spec(rack: AudioRack, path: PathOf<K>): KnobSpec | undefined
  get(rack: AudioRack, path: PathOf<K>): KnobValue | undefined
  set(rack: AudioRack, path: PathOf<K>, v: KnobValue): void
  /** what the slider is called when this value is exposed */
  label(rack: AudioRack, path: PathOf<K>, spec: KnobSpec): string
}

const BYPASS_KNOB: KnobSpec = { id: "bypass", label: "Bypass", min: 0, max: 1, default: 0, scale: "toggle", unit: "" }

const modulator = (rack: AudioRack, id: string) => rack.modulators.find((m) => m.id === id)
const route = (rack: AudioRack, id: string) => rack.routes.find((r) => r.id === id)

const VALUE_PATHS: { [K in PathKind]: PathStrategy<K> } = {
  knob: {
    spec: (rack, path) => {
      const pedal = pedalAt(rack, path.item)
      const spec = pedal && pedalSpec(pedal.type)
      return spec && knobSpec(spec, path.knob)
    },
    get: (rack, path) => pedalAt(rack, path.item)?.knobs[path.knob],
    set: (rack, path, v) => {
      const pedal = pedalAt(rack, path.item)
      if (pedal) pedal.knobs[path.knob] = v
    },
    label: (_, __, spec) => spec.label,
  },
  bypass: {
    spec: () => BYPASS_KNOB,
    get: (rack, path) => {
      const pedal = pedalAt(rack, path.item)
      return pedal && (pedal.bypass ?? false)
    },
    set: (rack, path, v) => {
      const pedal = pedalAt(rack, path.item)
      if (pedal) pedal.bypass = v
    },
    label: () => "Off",
  },
  blend: {
    spec: () => BLEND_KNOB,
    get: (rack, path) => {
      const split = splitAt(rack, path.item)
      return split && (split.blend ?? BLEND_KNOB.default)
    },
    set: (rack, path, v) => {
      const split = splitAt(rack, path.item)
      if (split) split.blend = v
    },
    label: (_, __, spec) => spec.label,
  },
  crossover: {
    spec: () => CROSSOVER_KNOB,
    get: (rack, path) => splitAt(rack, path.item)?.crossovers?.[path.index],
    set: (rack, path, v) => {
      const crossovers = splitAt(rack, path.item)?.crossovers
      if (crossovers) crossovers[path.index] = v
    },
    label: (_, __, spec) => spec.label,
  },
  modKnob: {
    spec: (rack, path) => {
      const m = modulator(rack, path.mod)
      const spec = m && modulatorSpec(m.type)
      return spec && knobSpec(spec, path.knob)
    },
    get: (rack, path) => modulator(rack, path.mod)?.knobs[path.knob],
    set: (rack, path, v) => {
      const m = modulator(rack, path.mod)
      if (m) m.knobs[path.knob] = v
    },
    label: (rack, path, spec) => {
      const m = modulator(rack, path.mod)
      return `${(m && modulatorSpec(m.type)?.label) ?? "Modulator"} ${spec.label}`
    },
  },
  depth: {
    spec: () => DEPTH_KNOB,
    get: (rack, path) => route(rack, path.route)?.depth,
    set: (rack, path, v) => {
      const r = route(rack, path.route)
      if (r) r.depth = v
    },
    label: (rack, path) => {
      const r = route(rack, path.route)
      const target = r && pedalAt(rack, r.to)
      const tSpec = target && pedalSpec(target.type)
      return `${tSpec ? `${tSpec.label} ` : ""}${(tSpec && knobSpec(tSpec, r!.knob)?.label) ?? ""} Movement`.trim()
    },
  },
}

/** TypeScript can't correlate `VALUE_PATHS[path.kind]` with `path` across the union; the one cast lives here. */
const strategy = (path: ValuePath) => VALUE_PATHS[path.kind] as unknown as PathStrategy<PathKind>

export const valueSpec = (rack: AudioRack, path: ValuePath): KnobSpec | undefined => strategy(path).spec(rack, path)

export const getValue = (rack: AudioRack, path: ValuePath): KnobValue | undefined => strategy(path).get(rack, path)

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
  return edit(doc, (d) => strategy(path).set(rackDraft(d), path, clampTo(spec, v)))
}

type ParamBase = Pick<ParamDef, "identifier" | "displayName" | "min" | "max">

const continuousParam = (base: ParamBase, spec: KnobSpec, cur: KnobValue): ParamDef => ({
  ...base,
  type: "float",
  default: Number(cur),
  ...(spec.unit ? { ui: { unit: spec.unit } } : {}),
})

/** The slider a control becomes, by how the control moves. */
const PARAM_FOR_SCALE: Record<KnobScale, (base: ParamBase, spec: KnobSpec, cur: KnobValue) => ParamDef> = {
  toggle: (base, _, cur) => ({ ...base, type: "bool", min: 0, max: 1, default: !!cur }),
  choice: (base, spec, cur) => ({ ...base, type: "choice", options: [...(spec.options ?? [])], default: Math.round(Number(cur)) }),
  linear: continuousParam,
  log: continuousParam,
}

/** Makes a control a slider people can set in Drift, starting at its current value. */
export function exposeValue(doc: ForgeDoc, path: ValuePath): OpResult<{ param: string }> {
  const rack = rackOf(doc)
  const spec = valueSpec(rack, path)
  const cur = getValue(rack, path)
  if (!spec || cur === undefined) return { error: "That control doesn't exist." }
  if (isParamRef(cur)) return { doc, param: cur.param }
  const label = strategy(path).label(rack, path, spec)
  const identifier = uniqueParamName(doc, label)
  const p = PARAM_FOR_SCALE[spec.scale]({ identifier, displayName: label, min: spec.min, max: spec.max }, spec, cur)
  return {
    param: identifier,
    doc: edit(doc, (d) => {
      d.params.push(p)
      strategy(path).set(rackDraft(d), path, { param: identifier })
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
    strategy(path).set(rackDraft(d), path, literal)
    if (!paramUsers(d as ForgeDoc, cur.param)) d.params = d.params.filter((q) => q.identifier !== cur.param)
  })
}
