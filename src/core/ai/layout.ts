import type { ForgeDoc } from "@/core/doc/types"
import { nodeDef } from "@/core/nodes/registry"

const COL = 280
const ROW = 230

/**
 * Places blocks an AI created (they arrive at 0,0) one column to the right of whatever feeds them,
 * then keeps Output to the right of everything. Blocks the user placed are left alone.
 */
export function placeNew(doc: ForgeDoc, created: Set<string>): ForgeDoc {
  if (!created.size) return doc
  const pos = new Map(doc.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  const sources = (id: string) => doc.edges.filter((e) => e.to === id).map((e) => e.from)
  const placed = new Set(doc.nodes.filter((n) => !created.has(n.id)).map((n) => n.id))
  const taken = (x: number, y: number) => [...placed].some((id) => Math.abs(pos.get(id)!.x - x) < COL / 2 && Math.abs(pos.get(id)!.y - y) < ROW / 2)

  // Repeated passes so chains of new blocks land in order.
  for (let pass = 0; pass < created.size + 1; pass++) {
    for (const id of created) {
      if (placed.has(id)) continue
      const src = sources(id).filter((s) => placed.has(s))
      if (pass < created.size && sources(id).some((s) => !placed.has(s))) continue
      let x: number
      let y: number
      if (src.length) {
        x = Math.max(...src.map((s) => pos.get(s)!.x)) + COL
        y = src.reduce((a, s) => a + pos.get(s)!.y, 0) / src.length
      } else {
        const xs = doc.nodes.filter((n) => placed.has(n.id)).map((n) => pos.get(n.id)!.x)
        x = xs.length ? Math.min(...xs) : 0
        y = 0
      }
      while (taken(x, y)) y += ROW
      pos.set(id, { x, y })
      placed.add(id)
    }
  }

  const out = doc.nodes.find((n) => nodeDef(n.type)?.output)
  if (out) {
    const maxX = Math.max(...doc.nodes.filter((n) => n.id !== out.id).map((n) => pos.get(n.id)!.x), -Infinity)
    if (pos.get(out.id)!.x <= maxX) pos.set(out.id, { x: maxX + COL, y: pos.get(out.id)!.y })
  }

  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })) }
}
