import type { EmitCtx, InputDef, NodeDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]

/** Separable gaussian along `dir`, at most 33 taps; spacing widens past a 16 px radius. */
function gaussian(c: EmitCtx, read: (uv: string) => string, dir: string, radius: string): string {
  return `float r = max(${radius}, 0.0);
    float sigma = max(r * 0.5, 0.0001);
    float stepPx = max(r / 16.0, 1.0);
    vec2 texel = ${dir} / ${c.res()};
    vec4 sum = vec4(0.0);
    float wsum = 0.0;
    for (int k = -16; k <= 16; ++k) {
        float o = float(k) * stepPx;
        if (abs(o) > r + 0.001) continue;
        float w = exp(-0.5 * o * o / (sigma * sigma));
        sum += ${read("uv + texel * o")} * w;
        wsum += w;
    }
    return sum / wsum;`
}

export const blurNodes: NodeDef[] = [
  {
    type: "blur",
    label: "Blur",
    category: "blur",
    description: "Soft, even gaussian blur.",
    // Its output is a single read of the last stage's buffer.
    cheap: true,
    inputs: [image, { id: "radius", label: "Radius (px)", type: "float", default: 8, min: 0, max: 64 }],
    outputs: out,
    heavyInputs: ["image"],
    stages: [
      { body: (c) => gaussian(c, (p) => c.in("image", p), "vec2(1.0, 0.0)", c.in("radius")) },
      { body: (c, prev) => gaussian(c, prev, "vec2(0.0, 1.0)", c.in("radius")) },
    ],
    emit: (_c, stage) => ({ image: `return ${stage("uv")};` }),
  },
  {
    type: "glow",
    label: "Glow",
    category: "blur",
    description: "Bright parts of the picture bleed soft light around them.",
    inputs: [
      image,
      { id: "threshold", label: "Threshold", type: "float", default: 0.6, min: 0, max: 1 },
      { id: "radius", label: "Radius (px)", type: "float", default: 16, min: 1, max: 64 },
      { id: "intensity", label: "Intensity", type: "float", default: 1, min: 0, max: 4 },
      { id: "tint", label: "Tint", type: "color", default: [1, 1, 1, 1], widget: "swatch" },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "glow", label: "Glow only", type: "color" },
    ],
    stages: [
      {
        body: (c) => `vec4 col = ${c.in("image")};
    return vec4(max(col.rgb - vec3(${c.in("threshold")}), 0.0) / max(1.0 - ${c.in("threshold")}, 0.0001), 1.0);`,
      },
      { body: (c, prev) => gaussian(c, prev, "vec2(1.0, 0.0)", c.in("radius")) },
      { body: (c, prev) => gaussian(c, prev, "vec2(0.0, 1.0)", c.in("radius")) },
    ],
    emit: (c, stage) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 g = ${stage("uv")}.rgb * ${c.in("tint")}.rgb * ${c.in("intensity")};
    return vec4(clamp(col.rgb + g, 0.0, 1.0), col.a);`,
      glow: `return vec4(clamp(${stage("uv")}.rgb * ${c.in("tint")}.rgb * ${c.in("intensity")}, 0.0, 1.0), 1.0);`,
    }),
  },
  {
    type: "directional_blur",
    label: "Motion blur",
    category: "blur",
    description: "Streak the picture in one direction, like fast movement.",
    inputs: [
      image,
      { id: "angle", label: "Angle", type: "float", default: 0, min: 0, max: 360, widget: "angle" },
      { id: "length", label: "Length (px)", type: "float", default: 30, min: 0, max: 300 },
    ],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => ({
      image: `float a = radians(${c.in("angle")});
    vec2 dir = vec2(cos(a), sin(a)) * ${c.in("length")} / ${c.res()};
    vec4 sum = vec4(0.0);
    for (int k = 0; k < 24; ++k) {
        float t = float(k) / 23.0 - 0.5;
        sum += ${c.in("image", "uv + dir * t")};
    }
    return sum / 24.0;`,
    }),
  },
  {
    type: "zoom_blur",
    label: "Zoom blur",
    category: "blur",
    description: "Streaks rushing out from a point, like zooming the lens mid-shot.",
    inputs: [
      image,
      { id: "strength", label: "Strength", type: "float", default: 0.15, min: 0, max: 1 },
      { id: "center", label: "Centre", type: "vec2", default: [0.5, 0.5], min: 0, max: 1, widget: "point" },
    ],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => ({
      image: `vec2 ctr = ${c.in("center")};
    vec4 sum = vec4(0.0);
    for (int k = 0; k < 24; ++k) {
        float s = 1.0 - ${c.in("strength")} * float(k) / 23.0;
        sum += ${c.in("image", "ctr + (uv - ctr) * s")};
    }
    return sum / 24.0;`,
    }),
  },
  {
    type: "chromatic",
    label: "RGB split",
    category: "blur",
    description: "Pull the red, green and blue channels apart, like a cheap lens or a glitch.",
    inputs: [
      image,
      { id: "amount", label: "Distance (px)", type: "float", default: 8, min: 0, max: 80 },
      { id: "angle", label: "Angle", type: "float", default: 0, min: 0, max: 360, widget: "angle" },
      { id: "center", label: "Centre (from the centre style)", type: "vec2", default: [0.5, 0.5], min: 0, max: 1, widget: "point" },
    ],
    options: [
      {
        id: "mode",
        label: "Style",
        kind: "select",
        options: [
          { value: "linear", label: "Sideways" },
          { value: "radial", label: "From the centre" },
        ],
        default: "linear",
      },
    ],
    outputs: out,
    emit: (c) => {
      const radial = c.opt<string>("mode") === "radial"
      return {
        image: `${
          radial
            ? `vec2 delta = (uv - ${c.in("center")}) * 2.0 * ${c.in("amount")} / ${c.res()};`
            : `float a = radians(${c.in("angle")});
    vec2 delta = vec2(cos(a), sin(a)) * ${c.in("amount")} / ${c.res()};`
        }
    vec4 g = ${c.in("image")};
    float r = ${c.in("image", "clamp(uv + delta, 0.0, 1.0)")}.r;
    float b = ${c.in("image", "clamp(uv - delta, 0.0, 1.0)")}.b;
    return vec4(r, g.g, b, g.a);`,
      }
    },
  },
  {
    type: "vignette",
    label: "Vignette",
    category: "blur",
    description: "Darken (or colour) the corners to pull focus to the middle.",
    inputs: [
      image,
      { id: "amount", label: "Amount", type: "float", default: 0.6, min: 0, max: 1 },
      { id: "radius", label: "Size", type: "float", default: 0.75, min: 0, max: 1.5 },
      { id: "softness", label: "Softness", type: "float", default: 0.45, min: 0.01, max: 1 },
      { id: "color", label: "Color", type: "color", default: [0, 0, 0, 1], widget: "swatch" },
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec2 d = (uv - 0.5) * vec2(${c.res()}.x / max(${c.res()}.y, 1.0), 1.0);
    float v = smoothstep(${c.in("radius")} - ${c.in("softness")}, ${c.in("radius")}, length(d) * 1.2);
    return vec4(mix(col.rgb, ${c.in("color")}.rgb, v * ${c.in("amount")}), col.a);`,
    }),
  },
  {
    type: "sharpen",
    label: "Sharpen",
    category: "blur",
    description: "Crisp up edges and fine detail.",
    inputs: [image, { id: "amount", label: "Amount", type: "float", default: 0.8, min: 0, max: 4 }],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => ({
      image: `vec2 px = 1.0 / ${c.res()};
    vec4 col = ${c.in("image")};
    vec4 n = ${c.in("image", "uv + vec2(px.x, 0.0)")} + ${c.in("image", "uv - vec2(px.x, 0.0)")}
           + ${c.in("image", "uv + vec2(0.0, px.y)")} + ${c.in("image", "uv - vec2(0.0, px.y)")};
    vec3 rgb = col.rgb + (col.rgb * 4.0 - n.rgb) * ${c.in("amount")};
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "edges",
    label: "Edge detect",
    category: "blur",
    description: "Find the outlines in the picture.",
    inputs: [image, { id: "strength", label: "Strength", type: "float", default: 2, min: 0, max: 10 }],
    outputs: [
      { id: "image", label: "Edges", type: "color" },
      { id: "mask", label: "Mask", type: "float" },
    ],
    heavyInputs: ["image"],
    emit: (c) => {
      c.helper("luma")
      const s = (dx: number, dy: number) => `luma(${c.in("image", `uv + vec2(${dx}.0, ${dy}.0) * px`)})`
      const body = `vec2 px = 1.0 / ${c.res()};
    float gx = -${s(-1, -1)} - 2.0 * ${s(-1, 0)} - ${s(-1, 1)} + ${s(1, -1)} + 2.0 * ${s(1, 0)} + ${s(1, 1)};
    float gy = -${s(-1, -1)} - 2.0 * ${s(0, -1)} - ${s(1, -1)} + ${s(-1, 1)} + 2.0 * ${s(0, 1)} + ${s(1, 1)};
    float e = clamp(length(vec2(gx, gy)) * ${c.in("strength")}, 0.0, 1.0);`
      return {
        image: `${body}
    return vec4(vec3(e), ${c.in("image")}.a);`,
        mask: `${body}
    return e;`,
      }
    },
  },
]
