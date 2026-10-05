import { describe, expect, it } from "vitest"
import { INSTRUMENTS, instrumentSamples } from "@/audio/preview/instruments"
import { defaultInput, newRow, renderPattern, STEPS, stepSeconds } from "@/audio/preview/pattern"
import type { PreviewInput } from "@/doc/types"

const SR = 48000
const peak = (x: Float32Array, from = 0, to = x.length) => {
  let p = 0
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}
const one = (instrument: string, ...steps: number[]): PreviewInput => ({
  mode: "pattern",
  bpm: 120,
  rows: [newRow(instrument, Array.from({ length: STEPS }, (_, i) => steps.includes(i)))],
  audio: "kennedy",
})

describe("preview step sequencer", () => {
  it("every instrument makes a sound that won't clip on its own", () => {
    for (const ins of INSTRUMENTS) {
      const s = instrumentSamples(ins.id, SR)
      const p = peak(s)
      expect(p, ins.id).toBeGreaterThan(0.1)
      expect(p, ins.id).toBeLessThanOrEqual(0.9 + 1e-6)
      expect(s.every(Number.isFinite), ins.id).toBe(true)
    }
  })

  it("renders exactly one bar with each hit on its step", () => {
    const [left, right] = renderPattern(one("rim", 4), SR)
    const step = Math.round(stepSeconds(120) * SR)
    expect(left.length).toBe(step * STEPS)
    expect(right.length).toBe(left.length)
    expect(peak(left, 0, 4 * step)).toBe(0)
    expect(peak(left, 4 * step, 5 * step)).toBeGreaterThan(0.1)
  })

  it("wraps a ringing hit on the last step back to the start of the bar", () => {
    const [left] = renderPattern(one("piano-C4", 15), SR)
    // The piano rings for 1.8 s; a 120 BPM bar is 2 s, so the last step's note runs past the end.
    expect(peak(left, 0, Math.round(0.5 * SR))).toBeGreaterThan(0.01)
  })

  it("leaves muted rows out and pans with equal power", () => {
    const muted = one("kick", 0)
    muted.rows[0].muted = true
    expect(peak(renderPattern(muted, SR)[0])).toBe(0)

    const hard = one("kick", 0)
    hard.rows[0].pan = 1
    const [l, r] = renderPattern(hard, SR)
    expect(peak(l)).toBeLessThan(1e-6)
    expect(peak(r)).toBeGreaterThan(0.5)
  })

  it("starts new documents on a beat with a chord", () => {
    const input = defaultInput()
    expect(input.mode).toBe("pattern")
    expect(input.rows.map((r) => r.instrument)).toEqual(["kick", "snare", "hat", "piano-C4", "piano-E4", "piano-G4"])
    const [left] = renderPattern(input, SR)
    expect(peak(left)).toBeGreaterThan(0.3)
    expect(peak(left)).toBeLessThanOrEqual(0.89 + 1e-6)
  })
})
