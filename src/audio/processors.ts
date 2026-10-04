// Drift's built-in audio processors and the sliders each one reads. An audio effect package only
// names one of these and sets the values, so the table has to match Drift's audio-effects/*/audio-effect.json.
import type { ForgeDoc, ParamDef } from "@/doc/types"
import { emptyDoc } from "@/doc/util"

export interface AudioProcessor {
  id: string
  label: string
  category: string
  icon: string
  /** audio fed ahead of the clip so delay lines are warm at its first sample */
  prerollMs: number
  params: ParamDef[]
}

const f = (identifier: string, displayName: string, min: number, max: number, def: number): ParamDef => ({ identifier, displayName, type: "float", min, max, default: def })
const b = (identifier: string, displayName: string, def: boolean): ParamDef => ({ identifier, displayName, type: "bool", min: 0, max: 1, default: def })

export const AUDIO_PROCESSORS: AudioProcessor[] = [
  {
    id: "autopan", label: "Auto-Pan", category: "space", icon: "move-horizontal", prerollMs: 0,
    params: [f("rate", "Rate", 0.01, 10.0, 0.5), f("amount", "Amount", 0.0, 1.0, 1.0), f("level_in", "Input Level", 0.0, 4.0, 1.0), f("level_out", "Output Level", 0.0, 4.0, 1.0)],
  },
  {
    id: "chorus", label: "Chorus", category: "space", icon: "layers", prerollMs: 150,
    params: [f("in_gain", "Input", 0.0, 1.0, 0.6), f("out_gain", "Output", 0.0, 1.0, 0.9), f("delay", "Delay (ms)", 1, 100, 55), f("decay", "Decay", 0.0, 1.0, 0.4), f("speed", "Speed", 0.1, 5.0, 0.25), f("depth", "Depth", 0.0, 10.0, 2.0)],
  },
  {
    id: "echo", label: "Echo", category: "space", icon: "repeat", prerollMs: 800,
    params: [f("delay", "Delay (ms)", 10, 900, 60), f("decay", "Decay", 0.1, 0.9, 0.4), f("in_gain", "Input", 0.0, 1.0, 0.8), f("out_gain", "Wet Mix", 0.0, 1.0, 0.88)],
  },
  {
    id: "flanger", label: "Flanger", category: "space", icon: "circle-dashed", prerollMs: 150,
    params: [f("rate", "Modulation Rate", 0.1, 10.0, 0.5), f("phase", "Stereo Phase", 0, 360, 90), f("delay", "Delay (ms)", 0, 30, 5), f("depth", "Depth", 0, 10, 2), f("regen", "Feedback", -95, 95, 0), f("mix", "Wet Mix", 0, 100, 71), b("invert", "Invert Phase", false)],
  },
  {
    id: "phaser", label: "Phaser", category: "space", icon: "circle-dot-dashed", prerollMs: 150,
    params: [f("speed", "Speed", 0.1, 2.0, 0.5), f("in_gain", "Input", 0.0, 1.0, 0.6), f("out_gain", "Output", 0.0, 1.0, 0.7), f("delay", "Delay", 0, 5, 3), f("decay", "Decay", 0.0, 1.0, 0.4)],
  },
  {
    id: "tremolo", label: "Tremolo", category: "space", icon: "audio-waveform", prerollMs: 0,
    params: [f("rate", "Rate", 0.1, 20.0, 5.0), f("depth", "Depth", 0.0, 1.0, 0.7)],
  },
  {
    id: "stereowiden", label: "Stereo Widen", category: "space", icon: "unfold-horizontal", prerollMs: 50,
    params: [f("drymix", "Dry Mix", 0.0, 1.0, 0.8), f("delay", "Delay (ms)", 1, 100, 20), f("feedback", "Feedback", 0.0, 1.0, 0.3), f("crossfeed", "Crossfeed", 0.0, 1.0, 0.3)],
  },
  {
    id: "bitcrush", label: "Bitcrush", category: "texture", icon: "binary", prerollMs: 0,
    params: [f("bits", "Bits", 1, 16, 6), f("samples", "Sample Rate", 1, 64, 16), f("mix", "Mix", 0.0, 1.0, 0.7)],
  },
  {
    id: "crystalizer", label: "Crystalize", category: "texture", icon: "gem", prerollMs: 0,
    params: [f("intensity", "Intensity", 0.0, 10.0, 2.0), f("colors", "Colors", 2, 64, 8)],
  },
  {
    id: "bitcrush_log", label: "8-Bit", category: "texture", icon: "cpu", prerollMs: 0,
    params: [f("bits", "Bits", 1, 16, 4), f("samples", "Sample Rate", 1, 64, 8), f("mix", "Mix", 0.0, 1.0, 1.0)],
  },
  {
    id: "tape", label: "Tape Saturation", category: "texture", icon: "cassette-tape", prerollMs: 200,
    params: [f("ratio", "Ratio", 1.0, 20.0, 4.0), f("threshold", "Threshold", 0.01, 1.0, 0.2), f("attack", "Attack (ms)", 1, 200, 5), f("release", "Release (ms)", 10, 1000, 50)],
  },
  {
    id: "vinyl", label: "Vinyl", category: "texture", icon: "disc-3", prerollMs: 100,
    params: [f("flutter", "Flutter", 0.0, 0.5, 0.15), f("highpass", "Rumble", 50, 500, 200), f("lowpass", "Cutoff", 2000, 12000, 6000), f("wobble", "Wobble Rate", 0.1, 5.0, 0.5)],
  },
  {
    id: "megaphone", label: "Megaphone", category: "transmission", icon: "megaphone", prerollMs: 50,
    params: [f("center", "Center Freq", 300, 4000, 1500), f("width", "Band Width", 200, 3000, 1200), f("grit", "Distortion", 0.0, 1.0, 0.5)],
  },
  {
    id: "muffled", label: "Muffled", category: "transmission", icon: "volume-x", prerollMs: 50,
    params: [f("cutoff", "Cutoff", 200, 4000, 800), f("gain", "Gain", 0.1, 2.0, 1.0)],
  },
  {
    id: "bandlimit", label: "Telephone", category: "transmission", icon: "phone", prerollMs: 50,
    params: [f("low_cut", "High-Pass", 100, 800, 300), f("high_cut", "Low-Pass", 2000, 6000, 3400)],
  },
  {
    id: "underwater", label: "Underwater", category: "transmission", icon: "droplets", prerollMs: 150,
    params: [f("cutoff", "Cutoff", 100, 2000, 500), f("wet", "Chorus", 0.0, 1.0, 0.6), f("motion", "Motion", 0.1, 2.0, 0.25)],
  },
  {
    id: "walkie", label: "Walkie-Talkie", category: "transmission", icon: "radio-receiver", prerollMs: 50,
    params: [f("grit", "Grit", 0.0, 1.0, 0.4), f("low_cut", "High-Pass", 200, 800, 400), f("high_cut", "Low-Pass", 1500, 5000, 3000)],
  },
  {
    id: "compressor", label: "Compressor", category: "utility", icon: "gauge", prerollMs: 150,
    params: [f("threshold", "Threshold (dB)", -40, -2, -18), f("ratio", "Ratio", 1.5, 12, 3), f("attack", "Attack (ms)", 1, 200, 20), f("release", "Release (ms)", 20, 1000, 250), f("makeup", "Makeup Gain", 1, 4, 2)],
  },
  {
    id: "deesser", label: "De-esser", category: "utility", icon: "ear", prerollMs: 50,
    params: [f("intensity", "Intensity", 0, 1, 0.35), f("amount", "Max Reduction", 0, 1, 0.5), f("frequency", "Frequency", 0, 1, 0.5)],
  },
  {
    id: "eq3", label: "EQ", category: "utility", icon: "sliders-horizontal", prerollMs: 50,
    params: [f("low", "Low", -12, 12, 0), f("mid", "Mid", -12, 12, 0), f("high", "High", -12, 12, 0)],
  },
  {
    id: "gate", label: "Noise Gate", category: "utility", icon: "door-closed", prerollMs: 150,
    params: [f("threshold", "Threshold", 0.001, 0.2, 0.02), f("ratio", "Strength", 1, 9, 3), f("attack", "Attack (ms)", 1, 100, 10), f("release", "Release (ms)", 20, 1000, 250)],
  },
  {
    id: "leveler", label: "Voice Leveler", category: "utility", icon: "equal", prerollMs: 300,
    params: [f("strength", "Strength", 1, 20, 6), f("peak", "Target Peak", 0.5, 1, 0.95)],
  },
  {
    id: "limiter", label: "Limiter", category: "utility", icon: "maximize", prerollMs: 150,
    params: [f("drive", "Drive", 1, 4, 1), f("ceiling", "Ceiling", 0.5, 1, 0.95)],
  },
  {
    id: "pitch", label: "Chipmunk", category: "voice", icon: "rabbit", prerollMs: 300,
    params: [f("pitch", "Pitch", 1.05, 2.0, 1.5)],
  },
  {
    id: "darklord", label: "Dark Lord", category: "voice", icon: "shield", prerollMs: 600,
    params: [f("pitch", "Pitch", 0.6, 0.95, 0.8), f("echo_delay", "Echo Delay (ms)", 10, 100, 40), f("echo_decay", "Echo Decay", 0.1, 0.9, 0.4), f("grit", "Distortion", 0.0, 1.0, 0.3)],
  },
  {
    id: "vibrato", label: "Wobble", category: "voice", icon: "activity", prerollMs: 100,
    params: [f("rate", "Rate", 0.1, 20.0, 4.0), f("depth", "Depth", 0.0, 1.0, 0.6)],
  },
]

export const audioProcessor = (id: string | undefined) => AUDIO_PROCESSORS.find((p) => p.id === id)

/** The sliders of `processor` at their factory values, as a fresh copy a document can own. */
export function processorParams(processor: AudioProcessor): ParamDef[] {
  return processor.params.map((p) => ({ ...p }))
}

export function newAudioDoc(processorId = "echo"): ForgeDoc {
  const processor = audioProcessor(processorId) ?? AUDIO_PROCESSORS[0]
  const doc = emptyDoc("audio", `My ${processor.label}`)
  doc.meta.category = processor.category
  doc.audio = { processor: processor.id }
  doc.params = processorParams(processor)
  return doc
}
