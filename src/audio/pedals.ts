// The pedals and modulators Drift's audio graph knows, read from pedals.json — which
// scripts/build-audio-wasm.sh extracts from the wasm module itself, so this list can never offer a
// pedal the preview (or Drift) cannot run. Everything below the catalog is Forge's presentation.
import catalog from "./pedals.json"

export type KnobScale = "linear" | "log" | "toggle" | "choice"

export interface KnobSpec {
  id: string
  label: string
  min: number
  max: number
  default: number
  scale: KnobScale
  unit: string
  aliases?: string[]
  options?: string[]
}

export interface PedalSpec {
  type: string
  label: string
  category: string
  prerollMs: number
  knobs: KnobSpec[]
}

export const PEDALS = catalog.pedals as PedalSpec[]
export const MODULATORS = catalog.modulators as PedalSpec[]

export const pedalSpec = (type: string) => PEDALS.find((p) => p.type === type)
export const modulatorSpec = (type: string) => MODULATORS.find((p) => p.type === type)

export function knobSpec(spec: PedalSpec, idOrAlias: string): KnobSpec | undefined {
  return spec.knobs.find((k) => k.id === idOrAlias || k.aliases?.includes(idOrAlias))
}

/** Toggles and choices switch; only continuous knobs take modulation. */
export const continuous = (k: KnobSpec) => k.scale === "linear" || k.scale === "log"

/** A split's own controls, which Drift's graph defines alongside the pedals. */
export const BLEND_KNOB: KnobSpec = { id: "blend", label: "Blend", min: 0, max: 1, default: 0.5, scale: "linear", unit: "" }
export const CROSSOVER_KNOB: KnobSpec = { id: "crossover", label: "Crossover", min: 20, max: 20000, default: 1000, scale: "log", unit: "Hz" }
/** Route depth: a fraction of the target knob's range. */
export const DEPTH_KNOB: KnobSpec = { id: "depth", label: "Depth", min: -1, max: 1, default: 0.3, scale: "linear", unit: "" }

export const MAX_LANES = 4
/** Splits nest at most this deep (a split in a lane of a split). */
export const MAX_SPLIT_DEPTH = 2
export const MAX_NODES = 64
export const MAX_STEPS = 16

export const isClassic = (type: string) => type.startsWith("classic.")

/** Palette groups, in order. Classic pedals are Drift's original fixed effects. */
export const PEDAL_GROUPS: { id: string; label: string; color: string }[] = [
  { id: "filter", label: "Filter", color: "#38bdf8" },
  { id: "texture", label: "Texture", color: "#fb923c" },
  { id: "space", label: "Space", color: "#a78bfa" },
  { id: "utility", label: "Utility", color: "#94a3b8" },
  { id: "voice", label: "Voice", color: "#f472b6" },
  { id: "transmission", label: "Transmission", color: "#34d399" },
]

export function pedalColor(spec: PedalSpec | undefined): string {
  return PEDAL_GROUPS.find((g) => g.id === spec?.category)?.color ?? "#94a3b8"
}

/** Lucide icon names Drift shows on the effect card, by the effect's first pedal. */
const ICONS: Record<string, string> = {
  filter: "audio-waveform",
  ladder: "audio-waveform",
  drive: "flame",
  reverb: "waves",
  convolution: "church",
  delay: "repeat",
  pan: "move-horizontal",
  gain: "volume-2",
  "classic.autopan": "move-horizontal",
  "classic.chorus": "layers",
  "classic.echo": "repeat",
  "classic.flanger": "circle-dashed",
  "classic.phaser": "circle-dot-dashed",
  "classic.tremolo": "audio-waveform",
  "classic.stereowiden": "unfold-horizontal",
  "classic.bitcrush": "binary",
  "classic.crystalizer": "gem",
  "classic.bitcrush_log": "cpu",
  "classic.tape": "cassette-tape",
  "classic.vinyl": "disc-3",
  "classic.megaphone": "megaphone",
  "classic.muffled": "volume-x",
  "classic.bandlimit": "phone",
  "classic.underwater": "droplets",
  "classic.walkie": "radio-receiver",
  "classic.compressor": "gauge",
  "classic.deesser": "ear",
  "classic.eq3": "sliders-horizontal",
  "classic.gate": "door-closed",
  "classic.leveler": "equal",
  "classic.limiter": "maximize",
  "classic.pitch": "rabbit",
  "classic.darklord": "shield",
  "classic.vibrato": "activity",
}

export const pedalIcon = (type: string | undefined) => (type && ICONS[type]) || "audio-lines"

/** A knob's value as people read it: "1.2 kHz", "350 ms", "Band-pass". */
export function formatKnob(k: KnobSpec, v: number | boolean): string {
  if (k.scale === "toggle") return v ? "On" : "Off"
  const n = Number(v)
  if (k.scale === "choice") return k.options?.[Math.round(n)] ?? String(Math.round(n))
  if (k.unit === "Hz" && n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 1 : 2)} kHz`
  const digits = Math.abs(k.max - k.min) >= 100 ? 0 : Math.abs(k.max - k.min) >= 10 ? 1 : 2
  return `${n.toFixed(digits)}${k.unit ? ` ${k.unit}` : ""}`
}

/** 0..1 position of a value on the knob's travel (log knobs spread decades evenly). */
export function knobNorm(k: KnobSpec, v: number): number {
  const t = k.scale === "log" ? Math.log(v / k.min) / Math.log(k.max / k.min) : (v - k.min) / (k.max - k.min)
  return Math.min(1, Math.max(0, t))
}

export function knobFromNorm(k: KnobSpec, t: number): number {
  const c = Math.min(1, Math.max(0, t))
  if (k.scale === "log") return k.min * Math.pow(k.max / k.min, c)
  if (k.scale === "choice" || k.scale === "toggle") return Math.round(k.min + c * (k.max - k.min))
  return k.min + c * (k.max - k.min)
}
