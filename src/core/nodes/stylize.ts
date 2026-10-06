import type { InputDef, NodeDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]
const clockIn: InputDef = { id: "t", label: "Time", type: "float", default: 0, clock: true }

export const stylizeNodes: NodeDef[] = [
  {
    type: "grain",
    label: "Film grain",
    category: "stylize",
    description: "Fine moving noise, like film stock.",
    inputs: [
      image,
      { id: "amount", label: "Amount", type: "float", default: 0.12, min: 0, max: 1 },
      { id: "size", label: "Grain size (px)", type: "float", default: 1.5, min: 1, max: 8 },
      clockIn,
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    outputs: out,
    emit: (c) => {
      c.helper("hash21")
      return {
        image: `vec4 col = ${c.in("image")};
    vec2 cell = floor(uv * ${c.res()} / max(${c.in("size")}, 1.0));
    float n = hash21(cell + floor(${c.in("t")} * 24.0) * 17.31 + ${c.in("seed")} * 3.17) - 0.5;
    return vec4(clamp(col.rgb + n * ${c.in("amount")}, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "scanlines",
    label: "Scanlines",
    category: "stylize",
    description: "Horizontal lines like an old TV or monitor.",
    inputs: [
      image,
      { id: "count", label: "Lines", type: "float", default: 240, min: 10, max: 1000 },
      { id: "amount", label: "Darkness", type: "float", default: 0.35, min: 0, max: 1 },
      { id: "speed", label: "Roll speed", type: "float", default: 0, min: -5, max: 5 },
      clockIn,
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    float l = 0.5 + 0.5 * sin((uv.y + ${c.in("t")} * ${c.in("speed")} * 0.05) * ${c.in("count")} * 3.14159);
    return vec4(col.rgb * (1.0 - ${c.in("amount")} * (1.0 - l)), col.a);`,
    }),
  },
  {
    type: "halftone",
    label: "Halftone",
    category: "stylize",
    description: "Comic-book printed dots.",
    inputs: [
      image,
      { id: "size", label: "Dot spacing (px)", type: "float", default: 10, min: 3, max: 60 },
      { id: "angle", label: "Angle", type: "float", default: 45, min: 0, max: 90, widget: "angle" },
      { id: "ink", label: "Ink", type: "color", default: [0.08, 0.08, 0.1, 1], widget: "swatch" },
      { id: "paper", label: "Paper", type: "color", default: [0.98, 0.96, 0.9, 1], widget: "swatch" },
    ],
    options: [{ id: "colored", label: "Keep colours", kind: "toggle", default: false }],
    outputs: out,
    emit: (c) => {
      c.helper("rot2")
      c.helper("luma")
      return {
        image: `vec2 px = uv * ${c.res()};
    mat2 m = rot2(radians(${c.in("angle")}));
    vec2 q = m * px / max(${c.in("size")}, 1.0);
    vec2 cellCenter = (floor(q) + 0.5);
    vec2 sampleUv = (transpose(m) * (cellCenter * max(${c.in("size")}, 1.0))) / ${c.res()};
    vec4 src = ${c.in("image", "clamp(sampleUv, 0.0, 1.0)")};
    float r = sqrt(1.0 - luma(src)) * 0.75;
    float d = length(q - cellCenter);
    float dotMask = 1.0 - smoothstep(r - 0.08, r + 0.08, d);
    vec3 ink = ${c.opt<boolean>("colored") ? "src.rgb" : `${c.in("ink")}.rgb`};
    return vec4(mix(${c.in("paper")}.rgb, ink, dotMask), ${c.in("image")}.a);`,
      }
    },
  },
  {
    type: "glitch_blocks",
    label: "Glitch blocks",
    category: "stylize",
    description: "Random slices of the frame jump sideways and split colour, like a broken signal.",
    inputs: [
      image,
      { id: "amount", label: "Strength", type: "float", default: 0.5, min: 0, max: 1 },
      { id: "blocks", label: "Slices", type: "float", default: 24, min: 2, max: 120 },
      { id: "rate", label: "Changes per second", type: "float", default: 12, min: 0, max: 60 },
      clockIn,
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    outputs: out,
    emit: (c) => {
      c.helper("hash21")
      return {
        image: `float tick = floor(${c.in("t")} * ${c.in("rate")}) + ${c.in("seed")} * 31.7;
    float row = floor(uv.y * ${c.in("blocks")});
    float h = hash21(vec2(row, tick));
    float on = step(1.0 - ${c.in("amount")} * 0.6, h);
    float shift = (hash21(vec2(tick, row * 1.7)) - 0.5) * 0.25 * ${c.in("amount")} * on;
    vec2 p = vec2(fract(uv.x + shift), uv.y);
    vec4 g = ${c.in("image", "p")};
    float r = ${c.in("image", "vec2(fract(p.x + shift * 0.3), p.y)")}.r;
    float b = ${c.in("image", "vec2(fract(p.x - shift * 0.3), p.y)")}.b;
    return vec4(r, g.g, b, g.a);`,
      }
    },
  },
  {
    type: "vhs",
    label: "VHS",
    category: "stylize",
    description: "Tape wobble, colour bleed and noise bands.",
    inputs: [
      image,
      { id: "amount", label: "Strength", type: "float", default: 0.6, min: 0, max: 1 },
      clockIn,
    ],
    outputs: out,
    emit: (c) => {
      c.helper("valueNoise")
      c.helper("hash21")
      return {
        image: `float a = ${c.in("amount")};
    float t = ${c.in("t")};
    float wob = (valueNoise(vec2(uv.y * 8.0, t * 4.0)) - 0.5) * 0.01 * a;
    float band = smoothstep(0.96, 1.0, sin(uv.y * 3.0 - t * 1.7) * 0.5 + 0.5);
    vec2 p = vec2(uv.x + wob + band * 0.02 * a, uv.y);
    vec4 g = ${c.in("image", "clamp(p, 0.0, 1.0)")};
    float r = ${c.in("image", "clamp(p + vec2(0.004 * a, 0.0), 0.0, 1.0)")}.r;
    float b = ${c.in("image", "clamp(p - vec2(0.004 * a, 0.0), 0.0, 1.0)")}.b;
    vec3 col = vec3(r, g.g, b);
    float n = hash21(floor(uv * ${c.res()} * 0.5) + floor(t * 30.0)) - 0.5;
    col += n * 0.08 * a + band * 0.15 * a;
    return vec4(clamp(col, 0.0, 1.0), g.a);`,
      }
    },
  },
]
