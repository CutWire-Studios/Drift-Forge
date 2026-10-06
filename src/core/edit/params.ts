import type { Draft } from "immer"
import { paramSpec } from "@/core/doc/params"
import { forEachRackValue } from "@/core/audio/values"
import { paramNameProblem } from "@/core/doc/naming"
import { nodeDef } from "@/core/nodes/registry"
import type { InputDef, OptionDef } from "@/core/nodes/types"
import {
  isParamRef,
  type AudioRack,
  type ForgeDoc,
  type InputValue,
  type KnobValue,
  type Literal,
  type ParamDef,
  type ParamDefault,
  type ParamUi,
  type ParamValues,
  type Rgba,
} from "@/core/doc/types"
import { rgbToHex } from "@/core/doc/util"
import { edit, type OpResult } from "./result"

function camel(label: string): string {
  const words = label
    .replace(/\(.*?\)/g, "")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const s = words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("")
  return /^[A-Za-z]/.test(s) ? s : `p${s}`
}

export function uniqueParamName(doc: ForgeDoc, base: string): string {
  const taken = new Set(doc.params.map((p) => p.identifier))
  let name = camel(base) || "value"
  if (paramNameProblem(name)) name = `${name}Value`
  if (paramNameProblem(name)) name = "value"
  let n = name
  for (let i = 2; taken.has(n); i++) n = `${name}${i}`
  return n
}

/** Display hints for Drift's inspector; today's Drift ignores them, so they're always written. */
function uiFor(input: InputDef): ParamUi | undefined {
  const ui: ParamUi = {}
  if (input.widget === "angle") {
    ui.control = "angle"
    ui.unit = "°"
  }
  const unit = input.unit ?? /\((px|s|%)\)/.exec(input.label)?.[1]
  if (unit) ui.unit = unit
  if (input.integer) ui.step = 1
  if (input.widget === "seed") ui.control = "seed"
  return Object.keys(ui).length ? ui : undefined
}

/** How many inputs, options and rack controls read a parameter. */
export function paramUsers(doc: ForgeDoc, name: string): number {
  let n = 0
  for (const node of doc.nodes) {
    for (const v of [...Object.values(node.inputs), ...Object.values(node.data)]) {
      if (isParamRef(v) && (Array.isArray(v.param) ? v.param.includes(name) : v.param === name)) n++
    }
  }
  if (doc.audio) forEachRackValue(doc.audio.rack, (v) => void (isParamRef(v) && v.param === name && n++))
  return n
}

function releaseParam(d: Draft<ForgeDoc>, identifier: string) {
  const p = d.params.find((p) => p.identifier === identifier) as ParamDef | undefined
  if (!p) return
  for (const n of d.nodes) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (!isParamRef(v)) continue
      if (Array.isArray(v.param)) {
        if (!v.param.includes(identifier)) continue
        n.inputs[k] = v.param.map((name) => Number(d.params.find((q) => q.identifier === name)?.default ?? 0)) as [number, number]
      } else if (v.param === identifier) n.inputs[k] = paramSpec(p).literal(p) as Draft<InputValue>
    }
    for (const [k, v] of Object.entries(n.data)) {
      if (isParamRef(v) && v.param === identifier) {
        n.data[k] = p.type === "clip" ? undefined : structuredClone(p.default)
      }
    }
  }
  if (d.audio) {
    forEachRackValue(d.audio.rack as AudioRack, (v, set) => {
      if (isParamRef(v) && v.param === identifier) set(typeof p.default === "boolean" ? p.default : Number(p.default))
    })
  }
}

type ExposableOption = Extract<OptionDef, { kind: "curve" | "gradient" | "asset" | "region" }>
const EXPOSABLE_OPTIONS: OptionDef["kind"][] = ["curve", "gradient", "asset", "region"]

export function optionExposable(o: OptionDef): o is ExposableOption {
  return EXPOSABLE_OPTIONS.includes(o.kind)
}

/** A literal as one number: a switch is 0 or 1, a point its x. */
function firstNumber(v: Literal): number {
  if (typeof v === "boolean") return v ? 1 : 0
  if (Array.isArray(v)) return v[0]
  return Number(v)
}

/** What an input goes back to once the sliders it was bound to are gone: a point for two, else the one's literal. */
function literalFor(params: (ParamDef | undefined)[]): Literal {
  if (params.length === 2) return [Number(params[0]?.default ?? 0), Number(params[1]?.default ?? 0)]
  const p = params[0]
  return p ? paramSpec(p).literal(p) : 0
}

type SliderShape = Omit<ParamDef, "identifier" | "displayName">

/** The slider an input becomes, shaped by its type and widget. */
function inputSlider(input: InputDef, cur: Literal, labels: string[]): SliderShape | { error: string } {
  const ui = uiFor(input)
  const base = { min: input.min ?? 0, max: input.max ?? 1, ...(ui ? { ui } : {}) }
  const num = firstNumber(cur)
  if (input.type === "color") {
    if (input.widget !== "swatch") return { error: "Image inputs can't be sliders; connect an image instead." }
    const c = (Array.isArray(cur) && cur.length === 4 ? cur : [1, 1, 1, 1]) as Rgba
    return { type: "color", min: 0, max: 1, default: rgbToHex(c) }
  }
  if (input.type === "vec2") {
    const v = (Array.isArray(cur) ? cur : [num, num]) as [number, number]
    return { type: "point", ...base, default: [v[0], v[1]] }
  }
  if (input.widget === "toggle") return { type: "bool", min: 0, max: 1, default: num > 0.5 }
  if (input.widget === "choice") {
    return { type: "choice", min: 0, max: Math.max(labels.length - 1, 1), options: [...labels], default: Math.round(num) }
  }
  if (input.widget === "seed") return { type: "seed", ...base, default: Math.round(num) }
  if (input.integer) return { type: "int", ...base, default: Math.round(num) }
  return { type: "float", ...base, default: num }
}

/** Turns an unconnected setting into a Drift slider, shaped by the doc's target Drift. */
export function expose(doc: ForgeDoc, nodeId: string, inputId: string, labelOverride?: string): OpResult<{ params: string[] }> {
  const node = doc.nodes.find((n) => n.id === nodeId)
  const input = node && nodeDef(node.type)?.inputs.find((i) => i.id === inputId)
  if (!node || !input || input.noExpose) return { error: "That setting can't be a slider." }
  const cur = node.inputs[inputId] ?? input.default
  if (isParamRef(cur)) return { doc, params: [cur.param].flat() }
  const shape = inputSlider(input, cur, (node.data.labels as string[] | undefined) ?? [])
  if ("error" in shape) return shape
  const label = (labelOverride ?? input.label).replace(/\s*\(.*?\)/, "")
  const param = { identifier: uniqueParamName(doc, label), displayName: label, ...shape } as ParamDef
  return {
    params: [param.identifier],
    doc: edit(doc, (d) => {
      d.params.push(param)
      d.nodes.find((n) => n.id === nodeId)!.inputs[inputId] = { param: param.identifier }
    }),
  }
}

export function unexpose(doc: ForgeDoc, nodeId: string, inputId: string): ForgeDoc {
  const v = doc.nodes.find((n) => n.id === nodeId)?.inputs[inputId]
  if (!isParamRef(v)) return doc
  const names = Array.isArray(v.param) ? v.param : [v.param]
  return edit(doc, (d) => {
    const n = d.nodes.find((n) => n.id === nodeId)!
    const params = names.map((name) => d.params.find((p) => p.identifier === name) as ParamDef | undefined)
    n.inputs[inputId] = literalFor(params) as Draft<InputValue>
    for (const name of names) {
      if (!paramUsers(d as ForgeDoc, name)) d.params = d.params.filter((p) => p.identifier !== name)
    }
  })
}

/** The typed part of the slider an exposable option becomes. */
function optionSlider(option: ExposableOption, cur: unknown, shape: unknown): SliderShape | { error: string } {
  switch (option.kind) {
    case "asset":
      if (!cur) return { error: "Pick a picture first; it becomes the default." }
      return { min: 0, max: 1, type: "image", default: String(cur) }
    case "region":
      return { min: 0, max: 1, type: "region", default: structuredClone(cur as ParamValues["region"]), shape: shape === "rect" ? "rect" : "ellipse" }
    case "gradient":
      return { min: 0, max: 1, type: "gradient", default: structuredClone(cur as ParamValues["gradient"]) }
    case "curve":
      return { min: 0, max: 1, type: "curve", default: structuredClone(cur as ParamValues["curve"]) }
  }
}

/** Exposes a curve, gradient, picture or region option. */
export function exposeOption(doc: ForgeDoc, nodeId: string, optionId: string): OpResult<{ param: string }> {
  const node = doc.nodes.find((n) => n.id === nodeId)
  const option = node && nodeDef(node.type)?.options?.find((o) => o.id === optionId)
  if (!node || !option || !optionExposable(option)) return { error: "That setting can't be a slider." }
  const cur = node.data[optionId] ?? ("default" in option ? option.default : undefined)
  if (isParamRef(cur) && !Array.isArray(cur.param)) return { doc, param: cur.param }
  const shape = optionSlider(option, cur, node.data.shape)
  if ("error" in shape) return shape
  const p = { identifier: uniqueParamName(doc, option.label), displayName: option.label, ...shape } as ParamDef
  return {
    param: p.identifier,
    doc: edit(doc, (d) => {
      d.params.push(p)
      d.nodes.find((n) => n.id === nodeId)!.data[optionId] = { param: p.identifier }
    }),
  }
}

export function unexposeOption(doc: ForgeDoc, nodeId: string, optionId: string): ForgeDoc {
  const v = doc.nodes.find((n) => n.id === nodeId)?.data[optionId]
  if (!isParamRef(v) || Array.isArray(v.param)) return doc
  const name = v.param
  return edit(doc, (d) => {
    const p = d.params.find((q) => q.identifier === name)
    d.nodes.find((n) => n.id === nodeId)!.data[optionId] = p ? structuredClone(p.default) : undefined
    if (!paramUsers(d as ForgeDoc, name)) d.params = d.params.filter((q) => q.identifier !== name)
  })
}

export function addParam(doc: ForgeDoc, p: ParamDef): ForgeDoc {
  return edit(doc, (d) => {
    d.params.push(p)
  })
}

export function updateParam(doc: ForgeDoc, identifier: string, patch: Partial<ParamDef>): OpResult {
  const renamed = patch.identifier !== undefined && patch.identifier !== identifier
  if (renamed) {
    const problem = paramNameProblem(patch.identifier!)
    if (problem) return { error: problem }
    if (doc.params.some((p) => p.identifier === patch.identifier)) return { error: "Another slider already uses that name." }
  }
  return {
    doc: edit(doc, (d) => {
      const p = d.params.find((p) => p.identifier === identifier)
      if (!p) return
      Object.assign(p, patch)
      if (!renamed) return
      const to = patch.identifier!
      const swap = (v: unknown) => {
        if (!isParamRef(v)) return v
        if (Array.isArray(v.param)) return { param: v.param.map((x) => (x === identifier ? to : x)) }
        return v.param === identifier ? { param: to } : v
      }
      for (const n of d.nodes) {
        for (const k of Object.keys(n.inputs)) n.inputs[k] = swap(n.inputs[k]) as Draft<InputValue>
        for (const k of Object.keys(n.data)) n.data[k] = swap(n.data[k])
      }
      if (d.audio) forEachRackValue(d.audio.rack as AudioRack, (v, set) => set(swap(v) as KnobValue))
      for (const q of d.params) if (q.showWhen?.param === identifier) q.showWhen.param = to
      for (const pr of d.presets ?? []) {
        if (identifier in pr.values) {
          pr.values[to] = pr.values[identifier]
          delete pr.values[identifier]
        }
      }
    }),
  }
}

export function removeParam(doc: ForgeDoc, identifier: string): ForgeDoc {
  return edit(doc, (d) => {
    releaseParam(d, identifier)
    d.params = d.params.filter((p) => p.identifier !== identifier)
    for (const q of d.params) if (q.showWhen?.param === identifier) delete q.showWhen
    for (const pr of d.presets ?? []) delete pr.values[identifier]
  })
}

export function moveParam(doc: ForgeDoc, identifier: string, delta: number): ForgeDoc {
  return edit(doc, (d) => {
    const i = d.params.findIndex((p) => p.identifier === identifier)
    const j = i + delta
    if (i < 0 || j < 0 || j >= d.params.length) return
    const [p] = d.params.splice(i, 1)
    d.params.splice(j, 0, p)
  })
}
export function savePreset(doc: ForgeDoc, name: string, values: Record<string, ParamDefault>): ForgeDoc {
  const kept: Record<string, ParamDefault> = {}
  for (const p of doc.params) if (p.type !== "clip") kept[p.identifier] = structuredClone(values[p.identifier] ?? p.default)
  return edit(doc, (d) => {
    d.presets = [...(d.presets ?? []).filter((p) => p.name !== name), { name, values: kept }] as Draft<ForgeDoc["presets"]>
  })
}

export function deletePreset(doc: ForgeDoc, name: string): ForgeDoc {
  return edit(doc, (d) => {
    d.presets = (d.presets ?? []).filter((p) => p.name !== name)
  })
}
