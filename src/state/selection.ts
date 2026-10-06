import { allItems } from "@/core/audio/rack"
import type { ForgeDoc } from "@/core/doc/types"

/** Every id selection can point at: graph nodes, rack items and modulators. */
export function selectableIds(d: ForgeDoc): Set<string> {
  const ids = new Set(d.nodes.map((n) => n.id))
  if (d.audio) {
    for (const item of allItems(d.audio.rack)) ids.add(item.id)
    for (const m of d.audio.rack.modulators) ids.add(m.id)
  }
  return ids
}
