import type { InputDef, NodeDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]

export const colorNodes: NodeDef[] = [
  {
    type: "brightness_contrast",
    label: "Brightness / Contrast",
    category: "color",
    description: "Make the picture lighter, darker, flatter or punchier.",
    inputs: [
      image,
      { id: "brightness", label: "Brightness", type: "float", default: 0, min: -1, max: 1 },
      { id: "contrast", label: "Contrast", type: "float", default: 1, min: 0, max: 3 },
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 rgb = (col.rgb - 0.5) * ${c.in("contrast")} + 0.5 + ${c.in("brightness")};
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "saturation",
    label: "Saturation",
    category: "color",
    description: "0 is black and white, 1 is unchanged, above 1 is more colourful.",
    inputs: [image, { id: "amount", label: "Saturation", type: "float", default: 1, min: 0, max: 3 }],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    vec3 rgb = mix(vec3(luma(col)), col.rgb, ${c.in("amount")});
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "hue_shift",
    label: "Hue shift",
    category: "color",
    description: "Rotate every colour around the colour wheel.",
    inputs: [image, { id: "degrees", label: "Shift", type: "float", default: 90, min: -180, max: 180, widget: "angle" }],
    outputs: out,
    emit: (c) => {
      c.helper("hsv")
      return {
        image: `vec4 col = ${c.in("image")};
    vec3 hsv = rgb2hsv(col.rgb);
    hsv.x = fract(hsv.x + ${c.in("degrees")} / 360.0);
    return vec4(hsv2rgb(hsv), col.a);`,
      }
    },
  },
  {
    type: "levels",
    label: "Levels",
    category: "color",
    description: "Set the black point, white point and mid-tone gamma.",
    inputs: [
      image,
      { id: "black", label: "Black point", type: "float", default: 0, min: 0, max: 1 },
      { id: "white", label: "White point", type: "float", default: 1, min: 0, max: 1 },
      { id: "gamma", label: "Gamma", type: "float", default: 1, min: 0.1, max: 4 },
      { id: "outBlack", label: "Output black", type: "float", default: 0, min: 0, max: 1 },
      { id: "outWhite", label: "Output white", type: "float", default: 1, min: 0, max: 1 },
    ],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 rgb = clamp((col.rgb - ${c.in("black")}) / max(${c.in("white")} - ${c.in("black")}, 0.0001), 0.0, 1.0);
    rgb = pow(rgb, vec3(1.0 / max(${c.in("gamma")}, 0.0001)));
    return vec4(mix(vec3(${c.in("outBlack")}), vec3(${c.in("outWhite")}), rgb), col.a);`,
    }),
  },
  {
    type: "temperature",
    label: "Temperature",
    category: "color",
    description: "Warm the picture towards orange or cool it towards blue.",
    inputs: [image, { id: "amount", label: "Warmth", type: "float", default: 0.3, min: -1, max: 1 }],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    float t = ${c.in("amount")};
    vec3 rgb = col.rgb * vec3(1.0 + 0.25 * t, 1.0 + 0.05 * t, 1.0 - 0.25 * t);
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "tint",
    label: "Tint",
    category: "color",
    description: "Wash the picture with a colour.",
    inputs: [
      image,
      { id: "color", label: "Color", type: "color", default: [1, 0.55, 0.2, 1], widget: "swatch" },
      { id: "amount", label: "Amount", type: "float", default: 0.4, min: 0, max: 1 },
    ],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    vec3 tinted = luma(col) * ${c.in("color")}.rgb * 1.6;
    return vec4(mix(col.rgb, clamp(tinted, 0.0, 1.0), ${c.in("amount")}), col.a);`,
      }
    },
  },
  {
    type: "gradient_map",
    label: "Duotone",
    category: "color",
    description: "Replace dark areas with one colour and bright areas with another.",
    inputs: [
      image,
      { id: "shadow", label: "Shadows", type: "color", default: [0.04, 0.09, 0.16, 1], widget: "swatch" },
      { id: "highlight", label: "Highlights", type: "color", default: [1, 0.76, 0.03, 1], widget: "swatch" },
      { id: "amount", label: "Amount", type: "float", default: 1, min: 0, max: 1 },
    ],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    vec3 duo = mix(${c.in("shadow")}.rgb, ${c.in("highlight")}.rgb, smoothstep(0.0, 1.0, luma(col)));
    return vec4(mix(col.rgb, duo, ${c.in("amount")}), col.a);`,
      }
    },
  },
  {
    type: "invert",
    label: "Invert",
    category: "color",
    description: "Turn the picture into its negative.",
    inputs: [image, { id: "amount", label: "Amount", type: "float", default: 1, min: 0, max: 1 }],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    return vec4(mix(col.rgb, 1.0 - col.rgb, ${c.in("amount")}), col.a);`,
    }),
  },
  {
    type: "posterize",
    label: "Posterize",
    category: "color",
    description: "Reduce the number of colours for a flat, poster look.",
    inputs: [image, { id: "levels", label: "Levels", type: "float", default: 5, min: 2, max: 32, integer: true }],
    outputs: out,
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    float n = max(floor(${c.in("levels")}), 2.0) - 1.0;
    return vec4(floor(col.rgb * n + 0.5) / n, col.a);`,
    }),
  },
  {
    type: "threshold",
    label: "Threshold",
    category: "color",
    description: "Pure black and white: everything brighter than the level turns white.",
    inputs: [
      image,
      { id: "level", label: "Level", type: "float", default: 0.5, min: 0, max: 1 },
      { id: "softness", label: "Softness", type: "float", default: 0.02, min: 0, max: 0.5 },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "mask", label: "Mask", type: "float" },
    ],
    emit: (c) => {
      c.helper("luma")
      const m = `smoothstep(${c.in("level")} - ${c.in("softness")}, ${c.in("level")} + ${c.in("softness")} + 0.0001, luma(${c.in("image")}))`
      return {
        image: `vec4 col = ${c.in("image")};
    float m = smoothstep(${c.in("level")} - ${c.in("softness")}, ${c.in("level")} + ${c.in("softness")} + 0.0001, luma(col));
    return vec4(vec3(m), col.a);`,
        mask: `return ${m};`,
      }
    },
  },
  {
    type: "lut",
    label: "Color LUT",
    category: "color",
    description: "Apply a colour grade from a 512×512 LUT image (8×8 grid of 64×64 tiles).",
    inputs: [image, { id: "amount", label: "Amount", type: "float", default: 1, min: 0, max: 1 }],
    options: [{ id: "asset", label: "LUT image", kind: "asset" }],
    outputs: out,
    emit: (c) => {
      const tile = (slice: string) =>
        `vec2(mod(${slice}, 8.0), floor(${slice} / 8.0)) / 8.0 + (0.5 / 512.0) + rgb.rg * (63.0 / 512.0)`
      return {
        image: `vec4 col = ${c.in("image")};
    vec3 rgb = clamp(col.rgb, 0.0, 1.0);
    float b = rgb.b * 63.0;
    float s0 = floor(b);
    float s1 = min(s0 + 1.0, 63.0);
    vec3 a0 = ${c.asset(tile("s0"))}.rgb;
    vec3 a1 = ${c.asset(tile("s1"))}.rgb;
    vec3 graded = mix(a0, a1, b - s0);
    return vec4(mix(col.rgb, graded, ${c.in("amount")}), col.a);`,
      }
    },
  },
]
