// Drift's original audio effects: one built-in processor per package, with these sliders. Documents
// from before the pedalboard (schema 1) stored only a processor id; they open as a board holding
// that processor's classic pedal with every knob bound to the slider of the same name, which
// rack.ts's legacyProcessorFor recognises and exports in the old format.
import type { ForgeDoc, KnobValue, ParamDef, Pedal } from "@/doc/types"
import { emptyDoc } from "@/doc/util"
import { knobSpec, pedalSpec } from "./pedals"

export interface AudioProcessor {
  id: string
  label: string
  category: string
  params: ParamDef[]
}

const f = (identifier: string, displayName: string, min: number, max: number, def: number): ParamDef => ({ identifier, displayName, type: "float", min, max, default: def })
const b = (identifier: string, displayName: string, def: boolean): ParamDef => ({ identifier, displayName, type: "bool", min: 0, max: 1, default: def })

export const AUDIO_PROCESSORS: AudioProcessor[] = [
  { id: "autopan", label: "Auto-Pan", category: "space", params: [f("rate", "Rate", 0.01, 10.0, 0.5), f("amount", "Amount", 0.0, 1.0, 1.0), f("level_in", "Input Level", 0.0, 4.0, 1.0), f("level_out", "Output Level", 0.0, 4.0, 1.0)] },
  { id: "chorus", label: "Chorus", category: "space", params: [f("in_gain", "Input", 0.0, 1.0, 0.6), f("out_gain", "Output", 0.0, 1.0, 0.9), f("delay", "Delay (ms)", 1, 100, 55), f("decay", "Decay", 0.0, 1.0, 0.4), f("speed", "Speed", 0.1, 5.0, 0.25), f("depth", "Depth", 0.0, 10.0, 2.0)] },
  { id: "echo", label: "Echo", category: "space", params: [f("delay", "Delay (ms)", 10, 900, 60), f("decay", "Decay", 0.1, 0.9, 0.4), f("in_gain", "Input", 0.0, 1.0, 0.8), f("out_gain", "Wet Mix", 0.0, 1.0, 0.88)] },
  { id: "flanger", label: "Flanger", category: "space", params: [f("rate", "Modulation Rate", 0.1, 10.0, 0.5), f("phase", "Stereo Phase", 0, 360, 90), f("delay", "Delay (ms)", 0, 30, 5), f("depth", "Depth", 0, 10, 2), f("regen", "Feedback", -95, 95, 0), f("mix", "Wet Mix", 0, 100, 71), b("invert", "Invert Phase", false)] },
  { id: "phaser", label: "Phaser", category: "space", params: [f("speed", "Speed", 0.1, 2.0, 0.5), f("in_gain", "Input", 0.0, 1.0, 0.6), f("out_gain", "Output", 0.0, 1.0, 0.7), f("delay", "Delay", 0, 5, 3), f("decay", "Decay", 0.0, 1.0, 0.4)] },
  { id: "tremolo", label: "Tremolo", category: "space", params: [f("rate", "Rate", 0.1, 20.0, 5.0), f("depth", "Depth", 0.0, 1.0, 0.7)] },
  { id: "stereowiden", label: "Stereo Widen", category: "space", params: [f("drymix", "Dry Mix", 0.0, 1.0, 0.8), f("delay", "Delay (ms)", 1, 100, 20), f("feedback", "Feedback", 0.0, 1.0, 0.3), f("crossfeed", "Crossfeed", 0.0, 1.0, 0.3)] },
  { id: "bitcrush", label: "Bitcrush", category: "texture", params: [f("bits", "Bits", 1, 16, 6), f("samples", "Sample Rate", 1, 64, 16), f("mix", "Mix", 0.0, 1.0, 0.7)] },
  { id: "crystalizer", label: "Crystalize", category: "texture", params: [f("intensity", "Intensity", 0.0, 10.0, 2.0), f("colors", "Colors", 2, 64, 8)] },
  { id: "bitcrush_log", label: "8-Bit", category: "texture", params: [f("bits", "Bits", 1, 16, 4), f("samples", "Sample Rate", 1, 64, 8), f("mix", "Mix", 0.0, 1.0, 1.0)] },
  { id: "tape", label: "Tape Saturation", category: "texture", params: [f("ratio", "Ratio", 1.0, 20.0, 4.0), f("threshold", "Threshold", 0.01, 1.0, 0.2), f("attack", "Attack (ms)", 1, 200, 5), f("release", "Release (ms)", 10, 1000, 50)] },
  { id: "vinyl", label: "Vinyl", category: "texture", params: [f("flutter", "Flutter", 0.0, 0.5, 0.15), f("highpass", "Rumble", 50, 500, 200), f("lowpass", "Cutoff", 2000, 12000, 6000), f("wobble", "Wobble Rate", 0.1, 5.0, 0.5)] },
  { id: "megaphone", label: "Megaphone", category: "transmission", params: [f("center", "Center Freq", 300, 4000, 1500), f("width", "Band Width", 200, 3000, 1200), f("grit", "Distortion", 0.0, 1.0, 0.5)] },
  { id: "muffled", label: "Muffled", category: "transmission", params: [f("cutoff", "Cutoff", 200, 4000, 800), f("gain", "Gain", 0.1, 2.0, 1.0)] },
  { id: "bandlimit", label: "Telephone", category: "transmission", params: [f("low_cut", "High-Pass", 100, 800, 300), f("high_cut", "Low-Pass", 2000, 6000, 3400)] },
  { id: "underwater", label: "Underwater", category: "transmission", params: [f("cutoff", "Cutoff", 100, 2000, 500), f("wet", "Chorus", 0.0, 1.0, 0.6), f("motion", "Motion", 0.1, 2.0, 0.25)] },
  { id: "walkie", label: "Walkie-Talkie", category: "transmission", params: [f("grit", "Grit", 0.0, 1.0, 0.4), f("low_cut", "High-Pass", 200, 800, 400), f("high_cut", "Low-Pass", 1500, 5000, 3000)] },
  { id: "compressor", label: "Compressor", category: "utility", params: [f("threshold", "Threshold (dB)", -40, -2, -18), f("ratio", "Ratio", 1.5, 12, 3), f("attack", "Attack (ms)", 1, 200, 20), f("release", "Release (ms)", 20, 1000, 250), f("makeup", "Makeup Gain", 1, 4, 2)] },
  { id: "deesser", label: "De-esser", category: "utility", params: [f("intensity", "Intensity", 0, 1, 0.35), f("amount", "Max Reduction", 0, 1, 0.5), f("frequency", "Frequency", 0, 1, 0.5)] },
  { id: "eq3", label: "EQ", category: "utility", params: [f("low", "Low", -12, 12, 0), f("mid", "Mid", -12, 12, 0), f("high", "High", -12, 12, 0)] },
  { id: "gate", label: "Noise Gate", category: "utility", params: [f("threshold", "Threshold", 0.001, 0.2, 0.02), f("ratio", "Strength", 1, 9, 3), f("attack", "Attack (ms)", 1, 100, 10), f("release", "Release (ms)", 20, 1000, 250)] },
  { id: "leveler", label: "Voice Leveler", category: "utility", params: [f("strength", "Strength", 1, 20, 6), f("peak", "Target Peak", 0.5, 1, 0.95)] },
  { id: "limiter", label: "Limiter", category: "utility", params: [f("drive", "Drive", 1, 4, 1), f("ceiling", "Ceiling", 0.5, 1, 0.95)] },
  { id: "pitch", label: "Chipmunk", category: "voice", params: [f("pitch", "Pitch", 1.05, 2.0, 1.5)] },
  { id: "darklord", label: "Dark Lord", category: "voice", params: [f("pitch", "Pitch", 0.6, 0.95, 0.8), f("echo_delay", "Echo Delay (ms)", 10, 100, 40), f("echo_decay", "Echo Decay", 0.1, 0.9, 0.4), f("grit", "Distortion", 0.0, 1.0, 0.3)] },
  { id: "vibrato", label: "Wobble", category: "voice", params: [f("rate", "Rate", 0.1, 20.0, 4.0), f("depth", "Depth", 0.0, 1.0, 0.6)] },
]

export const audioProcessor = (id: string | undefined) => AUDIO_PROCESSORS.find((p) => p.id === id)

/** The classic pedal for `processorId`, each knob bound to the slider sharing its name or alias. */
export function classicPedal(processorId: string, params: ParamDef[]): Pedal | null {
  const spec = pedalSpec(`classic.${processorId}`)
  if (!spec) return null
  const knobs: Record<string, KnobValue> = {}
  for (const k of spec.knobs) {
    const p = params.find((q) => knobSpec(spec, q.identifier)?.id === k.id)
    knobs[k.id] = p ? { param: p.identifier } : k.scale === "toggle" ? k.default > 0.5 : k.default
  }
  return { id: "p1", type: spec.type, knobs }
}

/** Rewrites a schema-1 audio document ({ processor }) as a board of one classic pedal. */
export function migrateLegacyAudio(doc: ForgeDoc): void {
  const legacy = doc.audio as unknown as { processor?: string; rack?: unknown } | undefined
  if (!legacy || legacy.rack || !legacy.processor) return
  const pedal = classicPedal(legacy.processor, doc.params)
  doc.audio = { rack: { chain: pedal ? [pedal] : [], modulators: [], routes: [] } }
}

/** A board of one legacy processor with its original sliders: what schema-1 "New audio effect" made. */
export function legacyAudioDoc(processorId = "echo"): ForgeDoc {
  const processor = audioProcessor(processorId) ?? AUDIO_PROCESSORS[0]
  const doc = emptyDoc("audio", `My ${processor.label}`)
  doc.meta.category = processor.category
  doc.params = processor.params.map((p) => ({ ...p }))
  doc.audio = { rack: { chain: [classicPedal(processor.id, doc.params)!], modulators: [], routes: [] } }
  return doc
}
