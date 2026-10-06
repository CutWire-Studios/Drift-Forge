import type { CurveKey, GradientStop } from "./types"

export const LOOKUP_WIDTH = 256

export function easeK(ease: CurveKey["ease"], k: number): number {
  switch (ease) {
    case "smooth":
      return k * k * (3 - 2 * k)
    case "in":
      return k * k * k
    case "out":
      return 1 - (1 - k) ** 3
    case "hold":
      return 0
    default:
      return k
  }
}

/** Same evaluation as the Keyframe curve block's generated GLSL. */
export function evalCurve(keys: CurveKey[], t: number): number {
  const pts = [...keys].sort((a, b) => a.x - b.x)
  if (!pts.length) return 0
  if (t <= pts[0].x) return pts[0].y
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (t < b.x) return a.y + (b.y - a.y) * easeK(a.ease, (t - a.x) / Math.max(b.x - a.x, 1e-6))
  }
  return pts[pts.length - 1].y
}

/** Same evaluation as the Gradient map block's generated GLSL. */
export function evalGradient(stops: GradientStop[], t: number): number[] {
  const s = [...stops].sort((a, b) => a.pos - b.pos)
  if (!s.length) return [0, 0, 0, 1]
  if (t <= s[0].pos) return s[0].color
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (t < b.pos) {
      const k = (t - a.pos) / Math.max(b.pos - a.pos, 1e-6)
      return a.color.map((v, j) => v + (b.color[j] - v) * k)
    }
  }
  return s[s.length - 1].color
}

/** 256×1 RGBA pixels: a curve in the red channel, or a gradient. Sampled at texel centres. */
export function lookupPixels(kind: "curve" | "gradient", value: CurveKey[] | GradientStop[]): Uint8Array {
  const px = new Uint8Array(LOOKUP_WIDTH * 4)
  for (let i = 0; i < LOOKUP_WIDTH; i++) {
    const t = i / (LOOKUP_WIDTH - 1)
    const c =
      kind === "curve"
        ? [Math.min(1, Math.max(0, evalCurve(value as CurveKey[], t))), 0, 0, 1]
        : evalGradient(value as GradientStop[], t)
    for (let j = 0; j < 4; j++) px[i * 4 + j] = Math.round(Math.min(1, Math.max(0, c[j])) * 255)
  }
  return px
}
