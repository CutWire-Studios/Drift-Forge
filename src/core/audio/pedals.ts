// The pedals and modulators Drift's audio graph knows, read from pedals.json — which
// scripts/build-audio-wasm.sh extracts from the wasm module itself, so this list can never offer a
// pedal the preview (or Drift) cannot run. Everything below the catalog is Forge's presentation.
import { z } from "zod"
import { precisionFor } from "@/core/format"
import catalog from "./pedals.json"

const KnobSchema = z.object({
  id: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  default: z.number(),
  scale: z.enum(["linear", "log", "toggle", "choice"]),
  unit: z.string(),
  aliases: z.array(z.string()).optional(),
  options: z.array(z.string()).optional(),
})

const SpecSchema = z.object({
  type: z.string(),
  label: z.string(),
  category: z.string(),
  prerollMs: z.number(),
  knobs: z.array(KnobSchema),
})

const CatalogSchema = z.object({ version: z.number(), pedals: z.array(SpecSchema), modulators: z.array(SpecSchema) })

export type KnobSpec = z.infer<typeof KnobSchema>
export type KnobScale = KnobSpec["scale"]

/** What a pedal does beyond turning knobs, for the code that has to treat it specially. */
export interface PedalCapabilities {
  /** loads an impulse response (Pedal.ir) */
  impulseResponse: boolean
  /** one of Drift's original fixed effects, "classic.<processor>" */
  legacyClassic: boolean
  /** legacyClassic: the processor id schema-1 documents stored */
  legacyProcessor?: string
}

export interface PedalSpec extends z.infer<typeof SpecSchema> {
  capabilities: PedalCapabilities
}

const CLASSIC_PREFIX = "classic."
const IMPULSE_RESPONSE_PEDALS = new Set(["convolution"])

/** The classic pedal standing in for a legacy processor. */
export const classicPedalType = (processorId: string) => CLASSIC_PREFIX + processorId

function capabilitiesOf(type: string): PedalCapabilities {
  const legacyClassic = type.startsWith(CLASSIC_PREFIX)
  return {
    impulseResponse: IMPULSE_RESPONSE_PEDALS.has(type),
    legacyClassic,
    ...(legacyClassic ? { legacyProcessor: type.slice(CLASSIC_PREFIX.length) } : {}),
  }
}

const parsed = CatalogSchema.parse(catalog)
const withCapabilities = (specs: z.infer<typeof SpecSchema>[]): PedalSpec[] => specs.map((s) => ({ ...s, capabilities: capabilitiesOf(s.type) }))

export const PEDALS = withCapabilities(parsed.pedals)
export const MODULATORS = withCapabilities(parsed.modulators)

const PEDALS_BY_TYPE = new Map(PEDALS.map((p) => [p.type, p]))
const MODULATORS_BY_TYPE = new Map(MODULATORS.map((p) => [p.type, p]))

export const pedalSpec = (type: string) => PEDALS_BY_TYPE.get(type)
export const modulatorSpec = (type: string) => MODULATORS_BY_TYPE.get(type)

const knobIndexes = new WeakMap<PedalSpec, Map<string, number>>()

/**
 * Where a knob sits in its spec. The catalog lists knobs in the order the wasm graph numbers them,
 * so this is the index the running graph addresses the knob by.
 */
export function knobIndex(spec: PedalSpec, id: string): number {
  let index = knobIndexes.get(spec)
  if (!index) {
    index = new Map(spec.knobs.map((k, i) => [k.id, i]))
    knobIndexes.set(spec, index)
  }
  return index.get(id) ?? -1
}

export function knobSpec(spec: PedalSpec, idOrAlias: string): KnobSpec | undefined {
  return spec.knobs.find((k) => k.id === idOrAlias || k.aliases?.includes(idOrAlias))
}

/** A knob's value on a new pedal: toggles as switches, everything else as a number. */
export function knobDefault(k: KnobSpec): boolean | number {
  return k.scale === "toggle" ? k.default > 0.5 : k.default
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

export const isClassic = (type: string) => capabilitiesOf(type).legacyClassic

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
  const digits = Math.min(2, precisionFor(Math.abs(k.max - k.min)))
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
