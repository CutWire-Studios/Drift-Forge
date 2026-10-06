// The preview's step-sequencer input: rows of instruments over 16 steps, rendered into one bar of
// stereo audio that the worklet loops like any other sample.
import type { PreviewInput, SequencerRow } from "@/core/doc/types"
import { uid } from "@/core/doc/util"
import { instrumentSamples } from "./instruments"

export const STEPS = 16
/** -1 dBFS */
const CEILING = 0.89

const at = (...steps: number[]) => Array.from({ length: STEPS }, (_, i) => steps.includes(i))

export function newRow(instrument: string, steps: boolean[] = at()): SequencerRow {
  return { id: uid("r"), instrument, steps, volume: 0.8, pan: 0, muted: false }
}

/** A beat with a chord on top: enough to hear what reverbs, filters and dynamics do. */
export function defaultInput(): PreviewInput {
  return {
    mode: "pattern",
    bpm: 110,
    rows: [
      newRow("kick", at(0, 4, 8, 11)),
      newRow("snare", at(4, 12)),
      newRow("hat", at(0, 2, 4, 6, 8, 10, 12, 14)),
      newRow("piano-C4", at(0, 7)),
      newRow("piano-E4", at(0, 7)),
      newRow("piano-G4", at(0, 10)),
    ],
    audio: "kennedy",
  }
}

export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4
}

/**
 * One bar at `sampleRate`, both channels. Hits that ring past the bar wrap to its start, so the loop
 * joins seamlessly — what a pattern playing on repeat actually sounds like.
 */
export function renderPattern(input: PreviewInput, sampleRate: number): Float32Array[] {
  const step = Math.round(stepSeconds(input.bpm) * sampleRate)
  const length = step * STEPS
  const left = new Float32Array(length)
  const right = new Float32Array(length)
  for (const row of input.rows) {
    if (row.muted || !row.steps.some(Boolean)) continue
    const hit = instrumentSamples(row.instrument, sampleRate)
    // Equal-power pan.
    const angle = ((row.pan + 1) / 2) * (Math.PI / 2)
    const gl = Math.cos(angle) * row.volume * Math.SQRT2
    const gr = Math.sin(angle) * row.volume * Math.SQRT2
    row.steps.forEach((on, s) => {
      if (!on) return
      const start = s * step
      for (let i = 0; i < hit.length; i++) {
        const j = (start + i) % length
        left[j] += hit[i] * gl
        right[j] += hit[i] * gr
      }
    })
  }
  // Stacked rows can sum past full scale; turn the bar down rather than feed the board clipping.
  let peak = 0
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  if (peak > CEILING) {
    const g = CEILING / peak
    for (let i = 0; i < length; i++) {
      left[i] *= g
      right[i] *= g
    }
  }
  return [left, right]
}
