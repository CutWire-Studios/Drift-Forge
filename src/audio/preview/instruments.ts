// One-shot instruments for the preview's step sequencer, synthesized rather than shipped as files:
// a kit and a piano are a few hundred lines of maths, and rendered at the AudioContext's own rate
// they need no resampling and start exactly on the step.

export interface Instrument {
  id: string
  label: string
  group: "Drums" | "Bass" | "Piano"
}

const PIANO: [string, number][] = [
  ["C4", 261.63],
  ["D4", 293.66],
  ["E4", 329.63],
  ["F4", 349.23],
  ["G4", 392.0],
  ["A4", 440.0],
  ["B4", 493.88],
  ["C5", 523.25],
]

const BASS: [string, number][] = [
  ["C2", 65.41],
  ["E2", 82.41],
  ["G2", 98.0],
  ["A2", 110.0],
]

export const INSTRUMENTS: Instrument[] = [
  { id: "kick", label: "Kick", group: "Drums" },
  { id: "snare", label: "Snare", group: "Drums" },
  { id: "clap", label: "Clap", group: "Drums" },
  { id: "hat", label: "Closed hat", group: "Drums" },
  { id: "openhat", label: "Open hat", group: "Drums" },
  { id: "rim", label: "Rim", group: "Drums" },
  { id: "tom", label: "Tom", group: "Drums" },
  ...BASS.map(([n]) => ({ id: `bass-${n}`, label: `Bass ${n}`, group: "Bass" as const })),
  ...PIANO.map(([n]) => ({ id: `piano-${n}`, label: `Piano ${n}`, group: "Piano" as const })),
]

export const instrument = (id: string) => INSTRUMENTS.find((i) => i.id === id)

/** Deterministic noise, so the kit sounds the same on every load. */
function noiseSource(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296 * 2 - 1
  }
}

/** RBJ biquad, enough to shape noise into hats, snares and claps. */
function biquad(type: "highpass" | "bandpass" | "lowpass", freq: number, q: number, sr: number) {
  const w = (2 * Math.PI * freq) / sr
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  let b0: number, b1: number, b2: number
  if (type === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
  else if (type === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
  else [b0, b1, b2] = [alpha, 0, -alpha]
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
}

function render(seconds: number, sr: number, fn: (t: number, i: number) => number): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sr))
  for (let i = 0; i < out.length; i++) out[i] = fn(i / sr, i)
  return out
}

/** A short ramp so nothing starts with a click. */
const attack = (t: number, s = 0.002) => Math.min(1, t / s)

function synth(id: string, sr: number): Float32Array {
  const noise = noiseSource(id.length * 7919 + id.charCodeAt(0))
  switch (id) {
    case "kick": {
      let phase = 0
      return render(0.6, sr, (t) => {
        const f = 45 + 110 * Math.exp(-t / 0.035)
        phase += (2 * Math.PI * f) / sr
        return Math.tanh(1.6 * Math.sin(phase) * Math.exp(-t / 0.22)) * attack(t, 0.001) * 0.95
      })
    }
    case "snare": {
      const hp = biquad("highpass", 1800, 0.7, sr)
      return render(0.35, sr, (t) => attack(t) * (0.55 * hp(noise()) * Math.exp(-t / 0.08) + 0.45 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.05)))
    }
    case "clap": {
      const bp = biquad("bandpass", 1300, 1.2, sr)
      return render(0.4, sr, (t) => {
        // Three hands slightly apart, then the room.
        const burst = [0, 0.011, 0.023].reduce((a, s) => a + (t >= s ? Math.exp(-(t - s) / 0.006) : 0), 0)
        return bp(noise()) * (0.9 * burst + 0.5 * Math.exp(-t / 0.12)) * 2.2
      })
    }
    case "hat":
    case "openhat": {
      const hp = biquad("highpass", 7500, 0.8, sr)
      const decay = id === "hat" ? 0.035 : 0.28
      return render(id === "hat" ? 0.15 : 0.7, sr, (t) => hp(noise()) * Math.exp(-t / decay) * attack(t) * 0.75)
    }
    case "rim":
      return render(0.08, sr, (t) => (Math.sin(2 * Math.PI * 1700 * t) + 0.6 * Math.sin(2 * Math.PI * 820 * t)) * Math.exp(-t / 0.012) * attack(t, 0.0005) * 0.6)
    case "tom": {
      let phase = 0
      return render(0.6, sr, (t) => {
        phase += (2 * Math.PI * (95 + 45 * Math.exp(-t / 0.06))) / sr
        return Math.sin(phase) * Math.exp(-t / 0.2) * attack(t) * 0.85
      })
    }
  }
  if (id.startsWith("bass-")) {
    const f = BASS.find(([n]) => `bass-${n}` === id)![1]
    const lp = biquad("lowpass", 900, 1.1, sr)
    return render(0.9, sr, (t) => {
      // A few harmonics of a saw, low-passed: round, but audible on small speakers.
      let s = 0
      for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f * h * t) / h
      return lp(s) * Math.exp(-t / 0.4) * attack(t, 0.004) * 0.5
    })
  }
  if (id.startsWith("piano-")) {
    const f = PIANO.find(([n]) => `piano-${n}` === id)![1]
    // Stiff strings run slightly sharp in the upper partials, and those die away first.
    const partials = Array.from({ length: 10 }, (_, k) => {
      const n = k + 1
      return { f: f * n * Math.sqrt(1 + 0.0004 * n * n), a: 1 / Math.pow(n, 1.3), d: 1.6 / (1 + 0.45 * k) }
    })
    return render(1.8, sr, (t) => {
      let s = 0
      for (const p of partials) s += p.a * Math.sin(2 * Math.PI * p.f * t) * Math.exp(-t / p.d)
      return s * attack(t, 0.003) * 0.32
    })
  }
  return new Float32Array(1)
}

/** Peak each sound is scaled to, so the kit is balanced by choice rather than by the maths. */
function targetPeak(id: string): number {
  if (id === "kick") return 0.9
  if (id === "hat" || id === "openhat" || id === "rim") return 0.4
  if (id.startsWith("piano-")) return 0.45
  if (id.startsWith("bass-")) return 0.6
  return 0.7
}

const cache = new Map<string, Float32Array>()

export function instrumentSamples(id: string, sampleRate: number): Float32Array {
  const key = `${id}@${sampleRate}`
  let s = cache.get(key)
  if (!s) {
    s = synth(id, sampleRate)
    let peak = 0
    for (const v of s) peak = Math.max(peak, Math.abs(v))
    if (peak > 0) {
      const g = targetPeak(id) / peak
      for (let i = 0; i < s.length; i++) s[i] *= g
    }
    cache.set(key, s)
  }
  return s
}
