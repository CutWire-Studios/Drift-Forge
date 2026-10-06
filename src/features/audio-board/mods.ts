import { modulatorSpec } from "@/core/audio/pedals"
import type { AudioRack } from "@/core/doc/types"

// Each modulator gets its own colour, carried by its card, its routes' rings and its handle.
const HUES = ["#22d3ee", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#facc15"]

export function modColor(rack: AudioRack, id: string): string {
  const i = rack.modulators.findIndex((m) => m.id === id)
  return HUES[(i < 0 ? 0 : i) % HUES.length]
}

/** "LFO 1", "Envelope Follower 2": numbered within each type, in board order. */
export function modLabel(rack: AudioRack, id: string): string {
  const m = rack.modulators.find((x) => x.id === id)
  if (!m) return "Modulator"
  const n = rack.modulators.filter((x) => x.type === m.type).findIndex((x) => x.id === id) + 1
  return `${modulatorSpec(m.type)?.label ?? m.type} ${n}`
}
