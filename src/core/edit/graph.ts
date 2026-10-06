import type { Draft } from "immer"
import { createNode, nodeDef } from "@/core/nodes/registry"
import type { ForgeAsset, ForgeDoc, ForgeNode, InputValue, ParamDef } from "@/core/doc/types"
import { uid } from "@/core/doc/util"
import { edit, type OpResult } from "./result"
import { paramUsers, uniqueParamName } from "./params"

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

export function addAsset(doc: ForgeDoc, a: ForgeAsset): ForgeDoc {
  return edit(doc, (d) => {
    d.assets.push(a)
  })
}
