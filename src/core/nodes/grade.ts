import type { GradientStop } from "@/core/doc/types"
import { glslFloat } from "@/core/glsl/literals"
import type { InputDef, NodeDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]
const f = (id: string, label: string, def: number, min: number, max: number, extra: Partial<InputDef> = {}): InputDef => ({
  id,
  label,
  type: "float",
  default: def,
  min,
  max,
  ...extra,
})
const swatch = (id: string, label: string, c: [number, number, number, number]): InputDef => ({
  id,
  label,
  type: "color",
  default: c,
  widget: "swatch",
})

export const DEFAULT_GRADIENT: GradientStop[] = [
  { pos: 0, color: [0.05, 0.02, 0.15, 1] },
  { pos: 0.5, color: [0.85, 0.2, 0.35, 1] },
  { pos: 1, color: [1, 0.85, 0.4, 1] },
]

export const gradeNodes: NodeDef[] = [
  {
    type: "exposure",
    label: "Exposure",
    category: "color",
    description: "Brighten or darken like opening or closing the camera's aperture, in stops.",
    inputs: [image, f("stops", "Stops", 0.5, -4, 4, { unit: "EV" })],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    return vec4(clamp(col.rgb * exp2(${c.in("stops")}), 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "tone",
    label: "Shadows / Highlights",
    category: "color",
    description: "Lift or crush the dark parts and the bright parts separately, plus the extreme blacks and whites.",
    inputs: [
      image,
      f("shadows", "Shadows", 0.2, -1, 1),
      f("highlights", "Highlights", -0.1, -1, 1),
      f("blacks", "Blacks", 0, -1, 1),
      f("whites", "Whites", 0, -1, 1),
    ],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    float l = luma(col);
    float wS = 1.0 - smoothstep(0.0, 0.55, l);
    float wH = smoothstep(0.45, 1.0, l);
    float wB = 1.0 - smoothstep(0.0, 0.25, l);
    float wW = smoothstep(0.75, 1.0, l);
    float d = ${c.in("shadows")} * 0.5 * wS + ${c.in("highlights")} * 0.5 * wH + ${c.in("blacks")} * 0.3 * wB + ${c.in("whites")} * 0.3 * wW;
    return vec4(clamp(col.rgb + d, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "selective_color",
    label: "Selective colour",
    category: "color",
    description: "Change just one colour range: make the sky bluer, the skin warmer, or keep only the reds.",
    inputs: [
      image,
      f("hue", "Target hue", 0, 0, 360, { widget: "angle" }),
      f("range", "Range", 30, 1, 180, { unit: "°" }),
      f("softness", "Softness", 20, 0, 90, { unit: "°" }),
      f("shift", "Hue shift", 0, -180, 180, { widget: "angle" }),
      f("saturation", "Saturation", 0, -1, 1),
      f("lightness", "Lightness", 0, -1, 1),
      f("others", "Desaturate the rest", 0, 0, 1),
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "mask", label: "Selection", type: "float" },
    ],
    emit: (c) => {
      c.helper("hsv")
      const sel = `vec3 hsv = rgb2hsv(col.rgb);
    float dh = abs(fract(hsv.x - ${c.in("hue")} / 360.0 + 0.5) - 0.5) * 360.0;
    float m = (1.0 - smoothstep(${c.in("range")}, ${c.in("range")} + ${c.in("softness")} + 0.001, dh)) * smoothstep(0.05, 0.2, hsv.y);`
      return {
        image: `vec4 col = ${c.in("image")};
    ${sel}
    vec3 adj = vec3(fract(hsv.x + ${c.in("shift")} / 360.0), clamp(hsv.y * (1.0 + ${c.in("saturation")}), 0.0, 1.0), clamp(hsv.z * (1.0 + ${c.in("lightness")}), 0.0, 1.0));
    vec3 rest = mix(col.rgb, vec3(dot(col.rgb, vec3(0.2126, 0.7152, 0.0722))), ${c.in("others")});
    return vec4(mix(rest, hsv2rgb(adj), m), col.a);`,
        mask: `vec4 col = ${c.in("image")};
    ${sel}
    return m;`,
      }
    },
  },
  {
    type: "channel_mixer",
    label: "Channel mixer",
    category: "color",
    description: "Rebuild red, green and blue from any mix of the originals, for false-colour and film looks.",
    inputs: [
      image,
      f("rr", "Red ← red", 1, -2, 2),
      f("rg", "Red ← green", 0, -2, 2),
      f("rb", "Red ← blue", 0, -2, 2),
      f("gr", "Green ← red", 0, -2, 2),
      f("gg", "Green ← green", 1, -2, 2),
      f("gb", "Green ← blue", 0, -2, 2),
      f("br", "Blue ← red", 0, -2, 2),
      f("bg", "Blue ← green", 0, -2, 2),
      f("bb", "Blue ← blue", 1, -2, 2),
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 rgb = vec3(
        dot(col.rgb, vec3(${c.in("rr")}, ${c.in("rg")}, ${c.in("rb")})),
        dot(col.rgb, vec3(${c.in("gr")}, ${c.in("gg")}, ${c.in("gb")})),
        dot(col.rgb, vec3(${c.in("br")}, ${c.in("bg")}, ${c.in("bb")})));
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "lift_gamma_gain",
    label: "Colour wheels",
    category: "color",
    description: "Tint the shadows, mid-tones and highlights separately (lift, gamma, gain). Grey means no change.",
    inputs: [
      image,
      swatch("lift", "Shadows (lift)", [0.45, 0.5, 0.56, 1]),
      swatch("gamma", "Mid-tones (gamma)", [0.5, 0.5, 0.5, 1]),
      swatch("gain", "Highlights (gain)", [0.56, 0.52, 0.46, 1]),
      f("amount", "Amount", 1, 0, 1),
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 lift = (${c.in("lift")}.rgb - 0.5) * 0.5;
    vec3 gain = 1.0 + (${c.in("gain")}.rgb - 0.5);
    vec3 gam = exp2(-(${c.in("gamma")}.rgb - 0.5) * 2.0);
    vec3 rgb = col.rgb * gain;
    rgb = rgb + lift * (1.0 - rgb);
    rgb = pow(clamp(rgb, 0.0, 1.0), gam);
    return vec4(mix(col.rgb, rgb, ${c.in("amount")}), col.a);`,
    }),
  },
  {
    type: "vibrance",
    label: "Vibrance",
    category: "color",
    description: "Boost dull colours more than already-vivid ones, so skin doesn't go orange.",
    inputs: [image, f("amount", "Vibrance", 0.5, -1, 1)],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    float mx = max(col.r, max(col.g, col.b));
    float mn = min(col.r, min(col.g, col.b));
    float sat = mx - mn;
    float k = ${c.in("amount")} * (1.0 - sat);
    vec3 rgb = mix(vec3(luma(col)), col.rgb, 1.0 + k);
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "color_replace",
    label: "Replace colour",
    category: "color",
    description: "Swap one colour for another, keeping the light and shade.",
    inputs: [
      image,
      swatch("from", "Find", [0.85, 0.15, 0.15, 1]),
      swatch("to", "Replace with", [0.15, 0.45, 0.95, 1]),
      f("tolerance", "Tolerance", 0.25, 0, 1),
      f("softness", "Softness", 0.1, 0, 0.5),
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "mask", label: "Selection", type: "float" },
    ],
    emit: (c) => {
      const sel = `float dist = distance(col.rgb, ${c.in("from")}.rgb);
    float m = 1.0 - smoothstep(${c.in("tolerance")}, ${c.in("tolerance")} + ${c.in("softness")} + 0.0001, dist);`
      return {
        image: `vec4 col = ${c.in("image")};
    ${sel}
    vec3 moved = clamp(col.rgb - ${c.in("from")}.rgb + ${c.in("to")}.rgb, 0.0, 1.0);
    return vec4(mix(col.rgb, moved, m), col.a);`,
        mask: `vec4 col = ${c.in("image")};
    ${sel}
    return m;`,
      }
    },
  },
  {
    type: "chroma_key",
    label: "Green screen",
    category: "color",
    description: "Cut out a green (or any colour) screen, leaving the subject on a transparent background.",
    inputs: [
      image,
      swatch("key", "Screen colour", [0.1, 0.8, 0.2, 1]),
      f("tolerance", "Tolerance", 0.12, 0, 0.5),
      f("softness", "Edge softness", 0.08, 0, 0.5),
      f("spill", "Remove green spill", 0.5, 0, 1),
    ],
    outputs: [
      { id: "image", label: "Cut out", type: "color" },
      { id: "mask", label: "Subject mask", type: "float" },
    ],
    emit: (c) => {
      c.helper("ycc")
      const m = `vec3 k = rgb2ycc(${c.in("key")}.rgb);
    vec3 y = rgb2ycc(col.rgb);
    float dist = distance(y.yz, k.yz);
    float m = smoothstep(${c.in("tolerance")}, ${c.in("tolerance")} + ${c.in("softness")} + 0.0001, dist);`
      return {
        image: `vec4 col = ${c.in("image")};
    ${m}
    vec3 key = ${c.in("key")}.rgb;
    vec3 rgb = col.rgb;
    float dom = key.g >= max(key.r, key.b) ? rgb.g - max(rgb.r, rgb.b) : key.b >= key.r ? rgb.b - max(rgb.r, rgb.g) : rgb.r - max(rgb.g, rgb.b);
    vec3 spillDir = key / max(max(key.r, max(key.g, key.b)), 0.0001);
    rgb -= spillDir * max(dom, 0.0) * ${c.in("spill")};
    return vec4(clamp(rgb, 0.0, 1.0), col.a * m);`,
        mask: `vec4 col = ${c.in("image")};
    ${m}
    return m;`,
      }
    },
  },
  {
    type: "gradient_ramp",
    label: "Gradient map",
    category: "color",
    description: "Recolour by brightness through a colour gradient: fire, thermal, neon, film looks.",
    inputs: [image, f("amount", "Amount", 1, 0, 1)],
    options: [{ id: "stops", label: "Gradient", kind: "gradient", default: DEFAULT_GRADIENT }],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      const exposed = c.optParam("stops")
      let lookup: string
      if (exposed) lookup = `texture(${exposed}, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5))`
      else {
        const raw = c.opt<GradientStop[] | object>("stops")
        const stops = (Array.isArray(raw) && raw.length ? [...raw] : DEFAULT_GRADIENT).sort((a, b) => a.pos - b.pos)
        const v = (s: GradientStop) => `vec4(${s.color.map(glslFloat).join(", ")})`
        const fn = `${c.prefix}_grad`
        const lines = [`vec4 ${fn}(float t) {`, `    if (t <= ${glslFloat(stops[0].pos)}) return ${v(stops[0])};`]
        for (let i = 0; i + 1 < stops.length; i++) {
          const a = stops[i]
          const b = stops[i + 1]
          lines.push(
            `    if (t < ${glslFloat(b.pos)}) return mix(${v(a)}, ${v(b)}, (t - ${glslFloat(a.pos)}) / ${glslFloat(Math.max(b.pos - a.pos, 1e-6))});`,
          )
        }
        lines.push(`    return ${v(stops[stops.length - 1])};`, "}")
        c.declare(lines.join("\n"))
        lookup = `${fn}(t)`
      }
      return {
        image: `vec4 col = ${c.in("image")};
    float t = clamp(luma(col), 0.0, 1.0);
    vec4 g = ${lookup};
    return vec4(mix(col.rgb, g.rgb, ${c.in("amount")} * g.a), col.a);`,
      }
    },
  },
]
