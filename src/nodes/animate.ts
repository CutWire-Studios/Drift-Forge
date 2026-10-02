import type { CurvePoint, NodeDef } from "./types"

const clockIn = { id: "t", label: "Time", type: "float" as const, default: 0, clock: true }

function glslFloat(n: number): string {
  const s = String(Number(n.toFixed(6)))
  return s.includes(".") || s.includes("e") ? s : `${s}.0`
}

function easeExpr(ease: CurvePoint["ease"], k: string): string {
  switch (ease) {
    case "smooth":
      return `${k} * ${k} * (3.0 - 2.0 * ${k})`
    case "in":
      return `${k} * ${k} * ${k}`
    case "out":
      return `1.0 - pow(1.0 - ${k}, 3.0)`
    case "hold":
      return "0.0"
    default:
      return k
  }
}

export const animateNodes: NodeDef[] = [
  {
    type: "lfo",
    label: "Oscillator",
    category: "animate",
    description: "A value that swings back and forth over time: pulses, flickers, bounces.",
    inputs: [
      { id: "rate", label: "Cycles per second", type: "float", default: 1, min: 0, max: 20 },
      { id: "min", label: "Lowest", type: "float", default: 0, min: -10, max: 10 },
      { id: "max", label: "Highest", type: "float", default: 1, min: -10, max: 10 },
      { id: "phase", label: "Offset", type: "float", default: 0, min: 0, max: 1 },
      clockIn,
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    options: [
      {
        id: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "sine", label: "Smooth (sine)" },
          { value: "triangle", label: "Triangle" },
          { value: "saw", label: "Ramp up" },
          { value: "square", label: "On / off" },
          { value: "pulse", label: "Pulse (beat)" },
          { value: "random", label: "Random steps" },
        ],
        default: "sine",
      },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => {
      const shape = c.opt<string>("shape")
      if (shape === "random") c.helper("hash11")
      const w: Record<string, string> = {
        sine: "0.5 - 0.5 * cos(x * 6.2832)",
        triangle: "1.0 - abs(fract(x) * 2.0 - 1.0)",
        saw: "fract(x)",
        square: "step(0.5, fract(x))",
        pulse: "exp(-fract(x) * 6.0)",
        random: `hash11(floor(x) + 0.5 + ${c.in("seed")} * 13.1)`,
      }
      return {
        value: `float x = ${c.in("t")} * ${c.in("rate")} + ${c.in("phase")};
    return mix(${c.in("min")}, ${c.in("max")}, ${w[shape] ?? w.sine});`,
      }
    },
  },
  {
    type: "curve",
    label: "Keyframe curve",
    category: "animate",
    description: "Draw exactly how a value changes over time. Add points, drag them, pick how each one eases.",
    inputs: [
      { id: "min", label: "Bottom value", type: "float", default: 0, min: -10, max: 10 },
      { id: "max", label: "Top value", type: "float", default: 1, min: -10, max: 10 },
      { id: "length", label: "Length (s)", type: "float", default: 2, min: 0.1, max: 30, noExpose: true },
      clockIn,
    ],
    options: [
      {
        id: "points",
        label: "Curve",
        kind: "curve",
        default: [
          { x: 0, y: 0, ease: "smooth" },
          { x: 1, y: 1, ease: "linear" },
        ],
      },
      { id: "loop", label: "Loop", kind: "toggle", default: true },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => {
      const raw = c.opt<CurvePoint[] | object>("points")
      const pts = Array.isArray(raw) ? [...raw].sort((a, b) => a.x - b.x) : []
      const timeIn = c.kind === "transition" ? c.in("t") : `${c.in("t")} / max(${c.in("length")}, 0.0001)`
      const t =
        c.kind === "effect" && c.opt<boolean>("loop") ? `fract(${timeIn})` : `clamp(${timeIn}, 0.0, 1.0)`
      const lines = [`float t = ${t};`, "float y;"]
      const exposed = c.optParam("points")
      if (exposed) lines.push(`y = texture(${exposed}, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r;`)
      else if (pts.length === 0) lines.push("y = 0.0;")
      else {
        lines.push(`if (t <= ${glslFloat(pts[0].x)}) y = ${glslFloat(pts[0].y)};`)
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i]
          const b = pts[i + 1]
          const span = Math.max(b.x - a.x, 1e-6)
          lines.push(
            `else if (t < ${glslFloat(b.x)}) { float k = (t - ${glslFloat(a.x)}) / ${glslFloat(span)}; y = mix(${glslFloat(a.y)}, ${glslFloat(b.y)}, ${easeExpr(a.ease, "k")}); }`,
          )
        }
        lines.push(`else y = ${glslFloat(pts[pts.length - 1].y)};`)
      }
      lines.push(`return mix(${c.in("min")}, ${c.in("max")}, y);`)
      return { value: lines.join("\n    ") }
    },
  },
  {
    type: "ease",
    label: "Ease",
    category: "animate",
    description: "Reshape a 0→1 value so movement speeds up, slows down, overshoots or bounces.",
    inputs: [{ id: "t", label: "Input", type: "float", default: 0, clock: true }],
    options: [
      {
        id: "curve",
        label: "Curve",
        kind: "select",
        options: [
          { value: "inout", label: "Slow, fast, slow" },
          { value: "in", label: "Speed up" },
          { value: "out", label: "Slow down" },
          { value: "expo", label: "Snappy" },
          { value: "back", label: "Overshoot" },
          { value: "elastic", label: "Elastic" },
          { value: "bounce", label: "Bounce" },
          { value: "peak", label: "Up and back (0→1→0)" },
          { value: "peaksmooth", label: "Swell (smooth 0→1→0)" },
        ],
        default: "inout",
      },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => {
      const curve = c.opt<string>("curve")
      if (curve === "bounce") c.helper("ease")
      const e: Record<string, string> = {
        inout: "t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0",
        in: "t * t * t",
        out: "1.0 - pow(1.0 - t, 3.0)",
        expo: "t < 0.5 ? pow(2.0, 20.0 * t - 10.0) / 2.0 : (2.0 - pow(2.0, -20.0 * t + 10.0)) / 2.0",
        back: "1.0 + 2.70158 * pow(t - 1.0, 3.0) + 1.70158 * pow(t - 1.0, 2.0)",
        elastic: "t <= 0.0 ? 0.0 : t >= 1.0 ? 1.0 : pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * 2.0944) + 1.0",
        bounce: "easeOutBounce(t)",
        peak: "1.0 - abs(t * 2.0 - 1.0)",
        peaksmooth: "sin(t * 3.14159265)",
      }
      return {
        value: `float t = clamp(${c.in("t")}, 0.0, 1.0);
    return ${e[curve] ?? e.inout};`,
      }
    },
  },
  {
    type: "flicker",
    label: "Flicker",
    category: "animate",
    description: "Random brightness jumps, like a faulty bulb or an old projector.",
    inputs: [
      { id: "rate", label: "Changes per second", type: "float", default: 12, min: 0, max: 60 },
      { id: "amount", label: "Amount", type: "float", default: 0.4, min: 0, max: 1 },
      clockIn,
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => {
      c.helper("hash11")
      return { value: `return 1.0 - ${c.in("amount")} * hash11(floor(${c.in("t")} * ${c.in("rate")}) + 0.5 + ${c.in("seed")} * 13.1);` }
    },
  },
  {
    type: "steps",
    label: "Stepped",
    category: "animate",
    description: "Make smooth movement jump in steps, like stop-motion.",
    inputs: [
      { id: "x", label: "Input", type: "float", default: 0, clock: true },
      { id: "steps", label: "Steps per unit", type: "float", default: 8, min: 1, max: 60, integer: true },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => ({ value: `return floor(${c.in("x")} * ${c.in("steps")}) / max(${c.in("steps")}, 1.0);` }),
  },
]
