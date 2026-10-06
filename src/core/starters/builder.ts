// The small DSL the built-in starters are written in.
import type { ForgeDoc, InputValue, Kind, ParamDef } from "@/core/doc/types"
import { emptyDoc, uid } from "@/core/doc/util"
import { createNode, outputType } from "@/core/nodes/registry"

export interface Starter {
  name: string
  description: string
  doc: ForgeDoc
}

export class Graph {
  doc: ForgeDoc
  constructor(kind: Kind, name: string, category: string, description: string) {
    this.doc = emptyDoc(kind, name)
    this.doc.meta.category = category
    this.doc.meta.description = description
  }

  add(type: string, col: number, row: number, inputs: Record<string, InputValue> = {}, data: Record<string, unknown> = {}): string {
    const n = createNode(type, col * 280, row * 220)
    Object.assign(n.inputs, inputs)
    Object.assign(n.data, data)
    this.doc.nodes.push(n)
    return n.id
  }

  link(from: string, fromSocket: string, to: string, toSocket: string) {
    this.doc.edges.push({ id: uid("e"), from, fromSocket, to, toSocket })
  }

  param(p: ParamDef): { param: string } {
    this.doc.params.push(p)
    return { param: p.identifier }
  }

  output(col: number, row = 0): string {
    return this.add(outputType(this.doc.kind), col, row)
  }
}

/**
 * A Clip mask block: Drift's mask on the clip (e.g. Cut out subject), 1 on the person. `preview` is
 * the sample clip with a matte the editor previews on.
 */
export function personMatte(g: Graph, col: number, row: number, preview = "dancer") {
  g.doc.preview.clip = preview
  return g.add("clip_mask", col, row)
}

function starter(kind: Kind) {
  return (name: string, category: string, description: string, build: (g: Graph) => void): Starter => {
    const g = new Graph(kind, name, category, description)
    build(g)
    return { name, description, doc: g.doc }
  }
}

export const effect = starter("effect")
export const transition = starter("transition")

export const float = (identifier: string, displayName: string, def: number, min: number, max: number): ParamDef => ({
  identifier,
  displayName,
  type: "float",
  min,
  max,
  default: def,
})

export const color = (identifier: string, displayName: string, def: string): ParamDef => ({
  identifier,
  displayName,
  type: "color",
  min: 0,
  max: 1,
  default: def,
})
