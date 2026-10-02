import { isParamRef, type ForgeDoc } from "@/doc/types"
import { availableFor, nodeDef } from "@/nodes/registry"
import { GLSL_RESERVED } from "./glsl"

export interface CompileError {
  node?: string
  param?: string
  message: string
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Why `name` can't be a Drift parameter identifier, or null if it can. */
export function paramNameProblem(name: string): string | null {
  if (!IDENT.test(name)) return "Use letters, digits and _ only, starting with a letter."
  if (name.startsWith("u_") || name.startsWith("gl_")) return 'Names starting with "u_" or "gl_" are reserved by Drift.'
  if (/^(n|s|k|x|pv)_/.test(name)) return "Names starting with n_, s_, k_, x_ or pv_ are used by generated code."
  if (/^buf\d+$|^tex\d+$/.test(name)) return "That name is used by generated code."
  if (GLSL_RESERVED.has(name)) return "That word is reserved in shader code."
  if (name.length > 48) return "Keep it under 48 characters."
  return null
}


export function validate(doc: ForgeDoc, opts: { requireOutput: boolean }): CompileError[] {
  const errors: CompileError[] = []
  const ids = new Set(doc.nodes.map((n) => n.id))

  for (const n of doc.nodes) {
    const def = nodeDef(n.type)
    if (!def) errors.push({ node: n.id, message: `Unknown node "${n.type}".` })
    else if (!availableFor(def, doc.kind)) {
      errors.push({ node: n.id, message: `${def.label} can't be used in ${doc.kind === "effect" ? "an effect" : "a transition"}.` })
    }
  }

  const outputs = doc.nodes.filter((n) => nodeDef(n.type)?.output)
  if (opts.requireOutput && outputs.length === 0) errors.push({ message: "Add an Output node." })
  if (outputs.length > 1) for (const o of outputs.slice(1)) errors.push({ node: o.id, message: "Only one Output node is allowed." })

  const seenInputs = new Set<string>()
  for (const e of doc.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) {
      errors.push({ message: "A connection points at a deleted node." })
      continue
    }
    const key = `${e.to}:${e.toSocket}`
    if (seenInputs.has(key)) errors.push({ node: e.to, message: "An input has more than one connection." })
    seenInputs.add(key)
  }

  // Cycles: depth-first search over edges.
  const out = new Map<string, string[]>()
  for (const e of doc.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
  const state = new Map<string, 1 | 2>()
  const loop = (id: string): boolean => {
    if (state.get(id) === 1) return true
    if (state.get(id) === 2) return false
    state.set(id, 1)
    for (const next of out.get(id) ?? []) if (loop(next)) return true
    state.set(id, 2)
    return false
  }
  for (const n of doc.nodes) {
    if (loop(n.id)) {
      errors.push({ node: n.id, message: "The graph loops back on itself. Remove the connection that closes the loop." })
      break
    }
  }

  const names = new Set<string>()
  for (const p of doc.params) {
    const problem = paramNameProblem(p.identifier)
    if (problem) errors.push({ param: p.identifier, message: `Slider "${p.displayName}": ${problem}` })
    if (names.has(p.identifier)) errors.push({ param: p.identifier, message: `Two sliders are named "${p.identifier}".` })
    names.add(p.identifier)
    if (p.type === "color" && !(p.alpha ? /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/ : /^#[0-9a-fA-F]{6}$/).test(String(p.default))) {
      errors.push({ param: p.identifier, message: `Slider "${p.displayName}" needs a #rrggbb colour.` })
    }
    if (p.type === "choice" && !(p.options && p.options.length >= 2)) {
      errors.push({ param: p.identifier, message: `Dropdown "${p.displayName}" needs at least two choices.` })
    }
    if ((p.type === "float" || p.type === "int") && !(p.min < p.max)) {
      errors.push({ param: p.identifier, message: `Slider "${p.displayName}": the lowest value must be below the highest.` })
    }
  }

  for (const p of doc.params) {
    if (p.showWhen && !doc.params.some((q) => q.identifier === p.showWhen!.param && q.type === "bool")) {
      errors.push({ param: p.identifier, message: `Slider "${p.displayName}" is set to show with a switch that no longer exists.` })
    }
  }

  for (const n of doc.nodes) {
    for (const v of Object.values(n.data)) {
      if (isParamRef(v) && !Array.isArray(v.param) && !names.has(v.param)) {
        errors.push({ node: n.id, message: `Uses a slider "${v.param}" that no longer exists.` })
      }
    }
    for (const v of Object.values(n.inputs)) {
      if (!isParamRef(v)) continue
      for (const name of Array.isArray(v.param) ? v.param : [v.param]) {
        if (!names.has(name)) errors.push({ node: n.id, message: `Uses a slider "${name}" that no longer exists.` })
      }
    }
  }

  return errors
}
