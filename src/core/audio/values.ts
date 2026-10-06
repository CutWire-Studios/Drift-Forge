// Every slot in a rack that can hold a value or a slider binding, for the document ops that rename,
// count and release sliders. Kept apart from rack.ts so doc/ops can use it without a cycle.
import { isSplit, type AudioRack, type KnobValue, type RackItem } from "@/core/doc/types"

export function forEachRackValue(rack: AudioRack, visit: (value: KnobValue, set: (v: KnobValue) => void) => void): void {
  const walk = (chain: RackItem[]) => {
    for (const item of chain) {
      if (isSplit(item)) {
        if (item.blend !== undefined) visit(item.blend, (v) => (item.blend = v))
        item.crossovers?.forEach((c, i) => visit(c, (v) => (item.crossovers![i] = v)))
        for (const lane of item.lanes) walk(lane.chain)
        continue
      }
      for (const k of Object.keys(item.knobs)) visit(item.knobs[k], (v) => (item.knobs[k] = v))
      if (item.bypass !== undefined) visit(item.bypass, (v) => (item.bypass = v))
    }
  }
  walk(rack.chain)
  for (const m of rack.modulators) for (const k of Object.keys(m.knobs)) visit(m.knobs[k], (v) => (m.knobs[k] = v))
  for (const r of rack.routes) visit(r.depth, (v) => (r.depth = v))
}
