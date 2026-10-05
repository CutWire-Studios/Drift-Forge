// Pure edits on a ForgeDoc. The editor store, the AI tool executor (browser and Worker) and the
// MCP server all go through these, so a graph built by an AI behaves exactly like one built by hand.
import { produce, type Draft } from "immer"
import { forEachRackValue } from "@/audio/values"
import { paramNameProblem } from "@/compiler/validate"
import { createNode, nodeDef } from "@/nodes/registry"
import type { InputDef, OptionDef } from "@/nodes/types"
import {
  isParamRef,
  type AudioRack,
  type ForgeAsset,
  type ForgeDoc,
  type ForgeNode,
  type InputValue,
  type KnobValue,
  type Literal,
  type ParamDef,
  type ParamDefault,
  type ParamUi,
  type Rgba,
} from "./types"
import { hexToRgba, rgbToHex, uid } from "./util"

export type OpResult<T = object> = ({ doc: ForgeDoc } & T) | { error: string }

export function isOpError(r: OpResult<object>): r is { error: string } {
  return "error" in r
}

const edit = (doc: ForgeDoc, recipe: (d: Draft<ForgeDoc>) => void): ForgeDoc => produce(doc, recipe)

/** The literal an input falls back to when it stops being a slider. */
export function literalFromParam(p: ParamDef): Literal {
  switch (p.type) {
    case "color":
      return hexToRgba(String(p.default))
    case "bool":
      return p.default ? 1 : 0
    case "point":
      return [...(p.default as [number, number])] as [number, number]
    default:
      return Number(p.default)
  }
}

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

function reachable(doc: ForgeDoc, from: string, to: string): boolean {
  const out = new Map<string, string[]>()
  for (const e of doc.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  const stack = [from]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(out.get(id) ?? []))
  }
  return false
}

/** Puts every input/option bound to `identifier` back to a fixed value. */
function releaseParam(d: Draft<ForgeDoc>, identifier: string) {
  const p = d.params.find((p) => p.identifier === identifier) as ParamDef | undefined
  if (!p) return
  for (const n of d.nodes) {
    for (const [k, v] of Object.entries(n.inputs)) {
      if (!isParamRef(v)) continue
      if (Array.isArray(v.param)) {
        if (!v.param.includes(identifier)) continue
        n.inputs[k] = v.param.map((name) => Number(d.params.find((q) => q.identifier === name)?.default ?? 0)) as [number, number]
      } else if (v.param === identifier) n.inputs[k] = literalFromParam(p) as Draft<InputValue>
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

const EXPOSABLE_OPTIONS: OptionDef["kind"][] = ["curve", "gradient", "asset", "region"]

export function optionExposable(o: OptionDef): boolean {
  return EXPOSABLE_OPTIONS.includes(o.kind)
}

export function addNode(doc: ForgeDoc, type: string, x: number, y: number): OpResult<{ id: string }> {
  if (!nodeDef(type)) return { error: `Unknown block type "${type}".` }
  const n = createNode(type, x, y)
  let clipParam: ParamDef | null = null
  if (type === "other_clip") {
    clipParam = {
      identifier: uniqueParamName(doc, "Other clip"),
      displayName: "Other clip",
      type: "clip",
      min: 0,
      max: 1,
      default: "",
    }
    n.data.clip = { param: clipParam.identifier }
  }
  return {
    id: n.id,
    doc: edit(doc, (d) => {
      if (clipParam) d.params.push(clipParam)
      d.nodes.push(n)
    }),
  }
}

/** Removes blocks (never the Output) and every wire touching them. */
export function removeNodes(doc: ForgeDoc, ids: string[]): ForgeDoc {
  const del = new Set(ids.filter((id) => !nodeDef(doc.nodes.find((n) => n.id === id)?.type ?? "")?.output))
  return edit(doc, (d) => {
    d.nodes = d.nodes.filter((n) => !del.has(n.id))
    d.edges = d.edges.filter((e) => !del.has(e.from) && !del.has(e.to))
    // A clip slider only exists for its Other clip block.
    d.params = d.params.filter((p) => p.type !== "clip" || paramUsers(d as ForgeDoc, p.identifier) > 0)
  })
}

export function duplicateNodes(doc: ForgeDoc, ids: string[]): OpResult<{ ids: string[] }> {
  const map = new Map<string, string>()
  const copies: ForgeNode[] = []
  for (const n of doc.nodes) {
    if (!ids.includes(n.id) || nodeDef(n.type)?.output) continue
    const c = structuredClone(n) as ForgeNode
    c.id = uid("n")
    c.x += 40
    c.y += 40
    map.set(n.id, c.id)
    copies.push(c)
  }
  return {
    ids: [...map.values()],
    doc: edit(doc, (d) => {
      d.nodes.push(...copies)
      for (const e of doc.edges) {
        if (map.has(e.from) && map.has(e.to)) d.edges.push({ ...e, id: uid("e"), from: map.get(e.from)!, to: map.get(e.to)! })
      }
    }),
  }
}

export function moveNode(doc: ForgeDoc, id: string, x: number, y: number): ForgeDoc {
  return edit(doc, (d) => {
    const n = d.nodes.find((n) => n.id === id)
    if (n) {
      n.x = x
      n.y = y
    }
  })
}

/** Wires an output into an input, replacing whatever fed that input. Refuses loops. */
export function connect(doc: ForgeDoc, from: string, fromSocket: string, to: string, toSocket: string): OpResult {
  const a = doc.nodes.find((n) => n.id === from)
  const b = doc.nodes.find((n) => n.id === to)
  if (!a || !b) return { error: "One of those blocks doesn't exist." }
  if (!nodeDef(a.type)?.outputs.some((o) => o.id === fromSocket)) return { error: `"${a.type}" has no output "${fromSocket}".` }
  if (!nodeDef(b.type)?.inputs.some((i) => i.id === toSocket)) return { error: `"${b.type}" has no input "${toSocket}".` }
  if (from === to || reachable(doc, to, from)) return { error: "That connection would make a loop." }
  return {
    doc: edit(doc, (d) => {
      d.edges = d.edges.filter((e) => !(e.to === to && e.toSocket === toSocket))
      d.edges.push({ id: uid("e"), from, fromSocket, to, toSocket })
    }),
  }
}

export function disconnect(doc: ForgeDoc, edgeIds: string[]): ForgeDoc {
  return edit(doc, (d) => {
    d.edges = d.edges.filter((e) => !edgeIds.includes(e.id))
  })
}

export function setInput(doc: ForgeDoc, node: string, input: string, value: InputValue): ForgeDoc {
  return edit(doc, (d) => {
    const n = d.nodes.find((n) => n.id === node)
    if (n) n.inputs[input] = value as Draft<InputValue>
  })
}

export function setData(doc: ForgeDoc, node: string, key: string, value: unknown): ForgeDoc {
  return edit(doc, (d) => {
    const n = d.nodes.find((n) => n.id === node)
    if (n) n.data[key] = value
  })
}

/** Turns an unconnected setting into a Drift slider, shaped by the doc's target Drift. */
export function expose(doc: ForgeDoc, nodeId: string, inputId: string, labelOverride?: string): OpResult<{ params: string[] }> {
  const node = doc.nodes.find((n) => n.id === nodeId)
  const def = node && nodeDef(node.type)
  const input = def?.inputs.find((i) => i.id === inputId)
  if (!node || !def || !input || input.noExpose) return { error: "That setting can't be a slider." }
  const cur = node.inputs[inputId] ?? input.default
  if (isParamRef(cur)) return { doc, params: Array.isArray(cur.param) ? cur.param : [cur.param] }
  const label = (labelOverride ?? input.label).replace(/\s*\(.*?\)/, "")
  const ui = uiFor(input)
  const base = { min: input.min ?? 0, max: input.max ?? 1, ...(ui ? { ui } : {}) }
  const num = typeof cur === "boolean" ? (cur ? 1 : 0) : Array.isArray(cur) ? cur[0] : Number(cur)
  const added: ParamDef[] = []
  let ref: InputValue
  const one = (p: Omit<ParamDef, "identifier" | "displayName">, name = label) => {
    const withAdded = { ...doc, params: [...doc.params, ...added] }
    const full = { identifier: uniqueParamName(withAdded, name), displayName: name, ...p } as ParamDef
    added.push(full)
    return full.identifier
  }

  if (input.type === "color") {
    if (input.widget !== "swatch") return { error: "Image inputs can't be sliders; connect an image instead." }
    const c = (Array.isArray(cur) && cur.length === 4 ? cur : [1, 1, 1, 1]) as Rgba
    ref = { param: one({ type: "color", min: 0, max: 1, default: rgbToHex(c) }) }
  } else if (input.type === "vec2") {
    const v = (Array.isArray(cur) ? cur : [num, num]) as [number, number]
    ref = { param: one({ type: "point", ...base, default: [v[0], v[1]] }) }
  } else if (input.widget === "toggle") {
    ref = { param: one({ type: "bool", min: 0, max: 1, default: num > 0.5 }) }
  } else if (input.widget === "choice") {
    const labels = (node.data.labels as string[] | undefined) ?? []
    ref = { param: one({ type: "choice", min: 0, max: Math.max(labels.length - 1, 1), options: [...labels], default: Math.round(num) }) }
  } else if (input.widget === "seed") {
    ref = { param: one({ type: "seed", ...base, default: Math.round(num) }) }
  } else if (input.integer) {
    ref = { param: one({ type: "int", ...base, default: Math.round(num) }) }
  } else {
    ref = { param: one({ type: "float", ...base, default: num }) }
  }
  return {
    params: added.map((p) => p.identifier),
    doc: edit(doc, (d) => {
      d.params.push(...added)
      d.nodes.find((n) => n.id === nodeId)!.inputs[inputId] = ref as Draft<InputValue>
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
    n.inputs[inputId] = (
      names.length === 2 ? params.map((p) => Number(p?.default ?? 0)) : params[0] ? literalFromParam(params[0]) : 0
    ) as Draft<InputValue>
    for (const name of names) {
      if (!paramUsers(d as ForgeDoc, name)) d.params = d.params.filter((p) => p.identifier !== name)
    }
  })
}

/** Exposes a curve, gradient, picture or region option. */
export function exposeOption(doc: ForgeDoc, nodeId: string, optionId: string): OpResult<{ param: string }> {
  const node = doc.nodes.find((n) => n.id === nodeId)
  const option = node && nodeDef(node.type)?.options?.find((o) => o.id === optionId)
  if (!node || !option || !optionExposable(option)) return { error: "That setting can't be a slider." }
  const cur = node.data[optionId] ?? ("default" in option ? option.default : undefined)
  if (isParamRef(cur) && !Array.isArray(cur.param)) return { doc, param: cur.param }
  const label = option.label
  const base = { identifier: uniqueParamName(doc, label), displayName: label, min: 0, max: 1 }
  let p: ParamDef
  if (option.kind === "asset") {
    if (!cur) return { error: "Pick a picture first; it becomes the default." }
    p = { ...base, type: "image", default: String(cur) }
  } else if (option.kind === "region") {
    p = { ...base, type: "region", default: structuredClone(cur as ParamDefault), shape: node.data.shape === "rect" ? "rect" : "ellipse" }
  } else {
    p = { ...base, type: option.kind as "curve" | "gradient", default: structuredClone(cur as ParamDefault) }
  }
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

export function addAsset(doc: ForgeDoc, a: ForgeAsset): ForgeDoc {
  return edit(doc, (d) => {
    d.assets.push(a)
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
