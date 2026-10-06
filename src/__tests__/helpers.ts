import type { ForgeDoc, Kind } from "@/core/doc/types"
import { emptyDoc, uid } from "@/core/doc/util"
import { createNode, outputType } from "@/core/nodes/registry"

/** A straight chain: source → types… → output, each linked through its first colour input. */
export function chain(kind: Kind, types: string[]): ForgeDoc {
  const doc = emptyDoc(kind)
  const src = createNode(kind === "effect" ? "video" : "from", 0, 0)
  doc.nodes.push(src)
  let prev = src.id
  for (const t of types) {
    const n = createNode(t, 0, 0)
    doc.nodes.push(n)
    doc.edges.push({ id: uid("e"), from: prev, fromSocket: "image", to: n.id, toSocket: "image" })
    prev = n.id
  }
  const out = createNode(outputType(kind), 0, 0)
  doc.nodes.push(out)
  doc.edges.push({ id: uid("e"), from: prev, fromSocket: "image", to: out.id, toSocket: "image" })
  return doc
}
