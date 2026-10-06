import type { HelperName, InputDef, NodeDef } from "./types"

const center: InputDef = {
  id: "center",
  label: "Centre",
  type: "vec2",
  default: [0.5, 0.5],
  min: 0,
  max: 1,
  widget: "point",
}

/** Signed distance to each shape of size `s` around `d`, negative inside. */
const SHAPE_SDF: Record<string, (s: string) => string> = {
  circle: (s) => `float sd = length(d) - ${s};`,
  box: (s) => `vec2 q = abs(d) - vec2(${s});
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);`,
  ring: (s) => `float sd = abs(length(d) - ${s}) - ${s} * 0.15;`,
  diamond: (s) => `float sd = (abs(d.x) + abs(d.y) - ${s}) * 0.7071;`,
  star: (s) => `float a = atan(d.x, -d.y);
    float seg = 6.2832 / 5.0;
    float k = abs(mod(a, seg) - seg * 0.5) / (seg * 0.5);
    float sd = length(d) - ${s} * mix(0.45, 1.0, k * k);`,
  heart: (s) => `vec2 h = vec2(abs(d.x), -d.y + ${s} * 0.25) / max(${s}, 0.0001);
    float sd = (length(h - vec2(0.0, 0.25 * (1.0 + h.x))) - 0.75 + h.x * 0.35) * ${s};`,
}

const NOISE_FN: Record<string, HelperName> = { cloud: "fbm", smooth: "valueNoise" }

export const generateNodes: NodeDef[] = [
  {
    type: "noise",
    label: "Noise",
    category: "generate",
    description: "Smooth random clouds. Great for dissolves, flicker and organic movement.",
    inputs: [
      { id: "scale", label: "Scale", type: "float", default: 6, min: 0.5, max: 60 },
      { id: "speed", label: "Speed", type: "float", default: 0.3, min: 0, max: 5 },
      { id: "t", label: "Time", type: "float", default: 0, clock: true },
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    options: [
      {
        id: "style",
        label: "Style",
        kind: "select",
        options: [
          { value: "cloud", label: "Clouds (detailed)" },
          { value: "smooth", label: "Smooth" },
          { value: "blocky", label: "Blocky" },
        ],
        default: "cloud",
      },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    emit: (c) => {
      const style = c.opt<string>("style")
      const fn = NOISE_FN[style] ?? "hash21"
      c.helper(fn)
      const p = `uv * vec2(${c.aspect()}, 1.0) * ${c.in("scale")} + vec2(${c.in("t")} * ${c.in("speed")}, ${c.in("t")} * ${c.in("speed")} * 0.7) + vec2(${c.in("seed")} * 17.31, ${c.in("seed")} * 7.77)`
      return { value: style === "blocky" ? `return hash21(floor(${p}));` : `return ${fn}(${p});` }
    },
  },
  {
    type: "linear_gradient",
    label: "Linear gradient",
    category: "generate",
    description: "A smooth blend between two colours across the frame.",
    inputs: [
      { id: "a", label: "Start", type: "color", default: [0, 0, 0, 1], widget: "swatch" },
      { id: "b", label: "End", type: "color", default: [1, 1, 1, 1], widget: "swatch" },
      { id: "angle", label: "Angle", type: "float", default: 90, min: 0, max: 360, widget: "angle" },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "t", label: "Amount", type: "float" },
    ],
    emit: (c) => {
      const t = `float ang = radians(${c.in("angle")});
    vec2 d = vec2(cos(ang), sin(ang));
    float t = clamp(dot(uv - 0.5, d) / max(abs(d.x) + abs(d.y), 0.0001) + 0.5, 0.0, 1.0);`
      return {
        image: `${t}
    return mix(${c.in("a")}, ${c.in("b")}, t);`,
        t: `${t}
    return t;`,
      }
    },
  },
  {
    type: "radial_gradient",
    label: "Radial gradient",
    category: "generate",
    description: "A soft circle of colour fading outwards.",
    inputs: [
      { id: "a", label: "Inside", type: "color", default: [1, 1, 1, 1], widget: "swatch" },
      { id: "b", label: "Outside", type: "color", default: [0, 0, 0, 1], widget: "swatch" },
      center,
      { id: "radius", label: "Radius", type: "float", default: 0.5, min: 0, max: 2 },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "t", label: "Amount", type: "float" },
    ],
    emit: (c) => {
      const t = `float asp = ${c.aspect()};
    float t = clamp(length((uv - ${c.in("center")}) * vec2(asp, 1.0)) / max(${c.in("radius")}, 0.0001), 0.0, 1.0);`
      return {
        image: `${t}
    return mix(${c.in("a")}, ${c.in("b")}, t);`,
        t: `${t}
    return t;`,
      }
    },
  },
  {
    type: "shape",
    label: "Shape",
    category: "generate",
    description: "A circle, box, ring, diamond or star. Outputs a mask: 1 inside, 0 outside.",
    inputs: [
      center,
      { id: "size", label: "Size", type: "float", default: 0.3, min: 0, max: 2 },
      { id: "softness", label: "Softness", type: "float", default: 0.01, min: 0, max: 0.5 },
      { id: "rotation", label: "Rotation", type: "float", default: 0, min: -360, max: 360, widget: "angle" },
    ],
    options: [
      {
        id: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "circle", label: "Circle" },
          { value: "box", label: "Box" },
          { value: "ring", label: "Ring" },
          { value: "diamond", label: "Diamond" },
          { value: "star", label: "Star" },
          { value: "heart", label: "Heart" },
        ],
        default: "circle",
      },
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => {
      c.helper("rot2")
      const s = c.in("size")
      const shape = c.opt<string>("shape")
      const sd = (SHAPE_SDF[shape] ?? SHAPE_SDF.circle)(s)
      return {
        mask: `float asp = ${c.aspect()};
    vec2 d = rot2(-radians(${c.in("rotation")})) * ((uv - ${c.in("center")}) * vec2(asp, 1.0));
    ${sd}
    float soft = max(${c.in("softness")}, 0.0005);
    return 1.0 - smoothstep(-soft, soft, sd);`,
      }
    },
  },
  {
    type: "stripes",
    label: "Stripes",
    category: "generate",
    description: "Repeating bands. Use as a mask for blinds and scanline-style looks.",
    inputs: [
      { id: "count", label: "Stripes", type: "float", default: 10, min: 1, max: 100, integer: true },
      { id: "angle", label: "Angle", type: "float", default: 0, min: 0, max: 360, widget: "angle" },
      { id: "width", label: "Width", type: "float", default: 0.5, min: 0, max: 1 },
      { id: "softness", label: "Softness", type: "float", default: 0.02, min: 0, max: 0.5 },
      { id: "speed", label: "Speed", type: "float", default: 0, min: -10, max: 10 },
      { id: "t", label: "Time", type: "float", default: 0, clock: true },
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float ang = radians(${c.in("angle")});
    float x = dot(uv - 0.5, vec2(cos(ang), sin(ang))) * ${c.in("count")} + ${c.in("t")} * ${c.in("speed")};
    float f = abs(fract(x) - 0.5) * 2.0;
    float soft = max(${c.in("softness")}, 0.0005);
    return 1.0 - smoothstep(${c.in("width")} - soft, ${c.in("width")} + soft, f);`,
    }),
  },
  {
    type: "checker",
    label: "Checkerboard",
    category: "generate",
    description: "Alternating squares.",
    inputs: [{ id: "count", label: "Squares across", type: "float", default: 8, min: 1, max: 100, integer: true }],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float asp = ${c.aspect()};
    vec2 q = floor(uv * vec2(asp, 1.0) * ${c.in("count")} / asp);
    return mod(q.x + q.y, 2.0);`,
    }),
  },
]
