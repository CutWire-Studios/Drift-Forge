import type { NodeDef } from "./types"

const BLEND_MODES = [
  { value: "normal", label: "Normal" },
  { value: "add", label: "Add (lighten)" },
  { value: "screen", label: "Screen" },
  { value: "multiply", label: "Multiply" },
  { value: "overlay", label: "Overlay" },
  { value: "softlight", label: "Soft light" },
  { value: "difference", label: "Difference" },
  { value: "lighten", label: "Lighten" },
  { value: "darken", label: "Darken" },
]

function blendExpr(mode: string): string {
  switch (mode) {
    case "add":
      return "min(b.rgb + l.rgb, 1.0)"
    case "screen":
      return "1.0 - (1.0 - b.rgb) * (1.0 - l.rgb)"
    case "multiply":
      return "b.rgb * l.rgb"
    case "overlay":
      return "blendOverlay(b.rgb, l.rgb)"
    case "softlight":
      return "blendSoftLight(b.rgb, l.rgb)"
    case "difference":
      return "abs(b.rgb - l.rgb)"
    case "lighten":
      return "max(b.rgb, l.rgb)"
    case "darken":
      return "min(b.rgb, l.rgb)"
    default:
      return "l.rgb"
  }
}

export const mixNodes: NodeDef[] = [
  {
    type: "mix",
    label: "Mix",
    category: "mix",
    description: "Blend between A and B. Plug a mask into Amount to choose per pixel.",
    inputs: [
      { id: "a", label: "A", type: "color", default: [0, 0, 0, 1] },
      { id: "b", label: "B", type: "color", default: [1, 1, 1, 1] },
      { id: "amount", label: "Amount", type: "float", default: 0.5, min: 0, max: 1 },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => ({ image: `return mix(${c.in("a")}, ${c.in("b")}, clamp(${c.in("amount")}, 0.0, 1.0));` }),
  },
  {
    type: "blend",
    label: "Blend",
    category: "mix",
    description: "Lay one image on top of another with a blend mode, like layers in a photo editor.",
    inputs: [
      { id: "base", label: "Base", type: "color", default: [0, 0, 0, 1] },
      { id: "layer", label: "Layer", type: "color", default: [1, 1, 1, 1] },
      { id: "opacity", label: "Opacity", type: "float", default: 1, min: 0, max: 1 },
    ],
    options: [{ id: "mode", label: "Mode", kind: "select", options: BLEND_MODES, default: "screen" }],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      const mode = c.opt<string>("mode")
      if (mode === "overlay" || mode === "softlight") c.helper("blend")
      return {
        image: `vec4 b = ${c.in("base")};
    vec4 l = ${c.in("layer")};
    vec3 rgb = ${blendExpr(mode)};
    return vec4(mix(b.rgb, rgb, clamp(${c.in("opacity")} * l.a, 0.0, 1.0)), b.a);`,
      }
    },
  },
  {
    type: "over",
    label: "Layer over",
    category: "mix",
    description: "Put Top over Bottom, respecting transparency.",
    inputs: [
      { id: "top", label: "Top", type: "color", default: [0, 0, 0, 0] },
      { id: "bottom", label: "Bottom", type: "color", default: [0, 0, 0, 1] },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      c.helper("over")
      return { image: `return over(${c.in("top")}, ${c.in("bottom")});` }
    },
  },
  {
    type: "luma_mask",
    label: "Brightness mask",
    category: "mix",
    description: "A mask from how bright each pixel is: dark is 0, bright is 1.",
    inputs: [
      { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] },
      { id: "low", label: "Low", type: "float", default: 0, min: 0, max: 1 },
      { id: "high", label: "High", type: "float", default: 1, min: 0, max: 1 },
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => {
      c.helper("luma")
      return { mask: `return smoothstep(${c.in("low")}, max(${c.in("high")}, ${c.in("low")} + 0.0001), luma(${c.in("image")}));` }
    },
  },
  {
    type: "set_alpha",
    label: "Cut out with mask",
    category: "mix",
    description: "Make parts of the image transparent where the mask is 0.",
    inputs: [
      { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] },
      { id: "mask", label: "Mask", type: "float", default: 1, min: 0, max: 1 },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    return vec4(col.rgb, col.a * clamp(${c.in("mask")}, 0.0, 1.0));`,
    }),
  },
  {
    type: "mask_ops",
    label: "Combine masks",
    category: "mix",
    description: "Add, subtract, intersect or invert masks.",
    inputs: [
      { id: "a", label: "A", type: "float", default: 0, min: 0, max: 1 },
      { id: "b", label: "B", type: "float", default: 0, min: 0, max: 1 },
    ],
    options: [
      {
        id: "op",
        label: "Operation",
        kind: "select",
        options: [
          { value: "union", label: "A or B" },
          { value: "intersect", label: "A and B" },
          { value: "subtract", label: "A minus B" },
          { value: "xor", label: "A or B, not both" },
          { value: "invert", label: "Invert A" },
        ],
        default: "union",
      },
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => {
      const a = `clamp(${c.in("a")}, 0.0, 1.0)`
      const b = `clamp(${c.in("b")}, 0.0, 1.0)`
      const e: Record<string, string> = {
        union: `max(${a}, ${b})`,
        intersect: `min(${a}, ${b})`,
        subtract: `clamp(${a} - ${b}, 0.0, 1.0)`,
        xor: `abs(${a} - ${b})`,
        invert: `1.0 - ${a}`,
      }
      return { mask: `return ${e[c.opt<string>("op")] ?? e.union};` }
    },
  },
  {
    type: "switch_image",
    label: "Pick image",
    category: "mix",
    description: "Show A when the switch is off and B when it's on. Pair with an exposed toggle.",
    inputs: [
      { id: "a", label: "Off", type: "color", default: [0, 0, 0, 1] },
      { id: "b", label: "On", type: "color", default: [1, 1, 1, 1] },
      { id: "on", label: "Switch", type: "float", default: 0, min: 0, max: 1, widget: "toggle" },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => ({ image: `return ${c.in("on")} > 0.5 ? ${c.in("b")} : ${c.in("a")};` }),
  },
]
