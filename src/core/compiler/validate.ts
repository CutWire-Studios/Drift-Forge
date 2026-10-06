import { KIND_INFO } from "@/core/doc/kinds"
import { isParamRef, type ForgeDoc, type ForgeNode, type ParamDef } from "@/core/doc/types"
import { availableFor, nodeDef } from "@/core/nodes/registry"
import { paramNameProblem } from "@/core/doc/naming"

export interface CompileError {
  node?: string
  param?: string
  message: string
}

type Check = (doc: ForgeDoc, opts: { requireOutput: boolean }) => CompileError[]

function checkNodeTypes(doc: ForgeDoc): CompileError[] {
  const errors: CompileError[] = []
  for (const n of doc.nodes) {
    const def = nodeDef(n.type)
    if (!def) errors.push({ node: n.id, message: `Unknown node "${n.type}".` })
    else if (!availableFor(def, doc.kind)) {
      errors.push({ node: n.id, message: `${def.label} can't be used in ${KIND_INFO[doc.kind].withArticle}.` })
    }
  }
  return errors
}

function checkOutputs(doc: ForgeDoc, opts: { requireOutput: boolean }): CompileError[] {
  const outputs = doc.nodes.filter((n) => nodeDef(n.type)?.output)
  if (opts.requireOutput && outputs.length === 0) return [{ message: "Add an Output node." }]
  return outputs.slice(1).map((o) => ({ node: o.id, message: "Only one Output node is allowed." }))
}

function checkEdges(doc: ForgeDoc): CompileError[] {
  const errors: CompileError[] = []
  const ids = new Set(doc.nodes.map((n) => n.id))
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
  return errors
}

/** Depth-first search over edges; reports the first node found on a loop. */
function checkLoops(doc: ForgeDoc): CompileError[] {
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
  const looped = doc.nodes.find((n) => loop(n.id))
  return looped ? [{ node: looped.id, message: "The graph loops back on itself. Remove the connection that closes the loop." }] : []
}

function paramValueProblem(p: ParamDef): string | null {
  if (p.type === "color" && !(p.alpha ? /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/ : /^#[0-9a-fA-F]{6}$/).test(String(p.default))) {
    return `Slider "${p.displayName}" needs a #rrggbb colour.`
  }
  if (p.type === "choice" && !(p.options && p.options.length >= 2)) return `Dropdown "${p.displayName}" needs at least two choices.`
  if ((p.type === "float" || p.type === "int") && !(p.min < p.max)) {
    return `Slider "${p.displayName}": the lowest value must be below the highest.`
  }
  return null
}

function checkParams(doc: ForgeDoc): CompileError[] {
  const errors: CompileError[] = []
  const names = new Set<string>()
  for (const p of doc.params) {
    const problem = paramNameProblem(p.identifier)
    if (problem) errors.push({ param: p.identifier, message: `Slider "${p.displayName}": ${problem}` })
    if (names.has(p.identifier)) errors.push({ param: p.identifier, message: `Two sliders are named "${p.identifier}".` })
    names.add(p.identifier)
    const valueProblem = paramValueProblem(p)
    if (valueProblem) errors.push({ param: p.identifier, message: valueProblem })
  }
  return errors
}

function checkShowWhen(doc: ForgeDoc): CompileError[] {
  const switches = new Set(doc.params.filter((q) => q.type === "bool").map((q) => q.identifier))
  return doc.params
    .filter((p) => p.showWhen && !switches.has(p.showWhen.param))
    .map((p) => ({ param: p.identifier, message: `Slider "${p.displayName}" is set to show with a switch that no longer exists.` }))
}

/** Every slider a node's data and inputs are bound to. */
function boundParams(n: ForgeNode): string[] {
  const fromData = Object.values(n.data).flatMap((v) => (isParamRef(v) && !Array.isArray(v.param) ? [v.param] : []))
  const fromInputs = Object.values(n.inputs).flatMap((v) => (isParamRef(v) ? [v.param].flat() : []))
  return [...fromData, ...fromInputs]
}

function checkBindings(doc: ForgeDoc): CompileError[] {
  const names = new Set(doc.params.map((p) => p.identifier))
  return doc.nodes.flatMap((n) =>
    boundParams(n)
      .filter((name) => !names.has(name))
      .map((name) => ({ node: n.id, message: `Uses a slider "${name}" that no longer exists.` })),
  )
}

const CHECKS: Check[] = [checkNodeTypes, checkOutputs, checkEdges, checkLoops, checkParams, checkShowWhen, checkBindings]

export function validate(doc: ForgeDoc, opts: { requireOutput: boolean }): CompileError[] {
  return CHECKS.flatMap((check) => check(doc, opts))
}
