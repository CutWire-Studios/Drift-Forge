import type { InputDef, NodeDef } from "./types"

const progress: InputDef = { id: "p", label: "Progress", type: "float", default: 0, clock: true }
const softness: InputDef = { id: "softness", label: "Softness", type: "float", default: 0.05, min: 0, max: 0.5 }

/** 1 where the incoming clip shows, sweeping a 0..1 field `x` as progress runs 0..1. */
const sweep = (x: string, p: string, soft: string) =>
  `float s = max(${soft}, 0.0001);
    float front = mix(-s, 1.0 + s, ${p});
    return 1.0 - smoothstep(front - s, front + s, ${x});`

export const transitionNodes: NodeDef[] = [
  {
    type: "wipe_mask",
    label: "Wipe mask",
    category: "transition",
    description: "A straight edge sweeping across the frame. Plug into Mix → Amount between From and To.",
    kinds: ["transition"],
    inputs: [
      { id: "angle", label: "Direction", type: "float", default: 0, min: 0, max: 360, widget: "angle" },
      softness,
      progress,
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float ang = radians(${c.in("angle")});
    vec2 d = vec2(cos(ang), sin(ang));
    float x = dot(uv - 0.5, d) / max(abs(d.x) + abs(d.y), 0.0001) + 0.5;
    ${sweep("x", c.in("p"), c.in("softness"))}`,
    }),
  },
  {
    type: "iris_mask",
    label: "Iris mask",
    category: "transition",
    description: "A circle growing from a point until it fills the frame.",
    kinds: ["transition"],
    inputs: [
      { id: "center", label: "Centre", type: "vec2", default: [0.5, 0.5], min: 0, max: 1, widget: "point" },
      softness,
      progress,
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float asp = ${c.aspect()};
    vec2 ctr = ${c.in("center")};
    vec2 far = max(ctr, 1.0 - ctr) * vec2(asp, 1.0);
    float x = length((uv - ctr) * vec2(asp, 1.0)) / max(length(far), 0.0001);
    ${sweep("x", c.in("p"), c.in("softness"))}`,
    }),
  },
  {
    type: "dissolve_mask",
    label: "Noise dissolve mask",
    category: "transition",
    description: "The new clip eats through the old one in organic, random patches.",
    kinds: ["transition"],
    inputs: [
      { id: "scale", label: "Patch size", type: "float", default: 5, min: 0.5, max: 40 },
      softness,
      progress,
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => {
      c.helper("fbm")
      return {
        mask: `float x = clamp((fbm(uv * vec2(${c.aspect()}, 1.0) * ${c.in("scale")} + ${c.in("seed")} * 7.31) - 0.2) / 0.6, 0.0, 1.0);
    ${sweep("x", c.in("p"), c.in("softness"))}`,
      }
    },
  },
  {
    type: "blinds_mask",
    label: "Blinds mask",
    category: "transition",
    description: "Many thin strips each opening at once, like venetian blinds.",
    kinds: ["transition"],
    inputs: [
      { id: "count", label: "Strips", type: "float", default: 10, min: 1, max: 60, integer: true },
      { id: "angle", label: "Direction", type: "float", default: 0, min: 0, max: 360, widget: "angle" },
      softness,
      progress,
    ],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float ang = radians(${c.in("angle")});
    float x = fract(dot(uv, vec2(cos(ang), sin(ang))) * ${c.in("count")});
    ${sweep("x", c.in("p"), c.in("softness"))}`,
    }),
  },
  {
    type: "edge_glow",
    label: "Edge glow",
    category: "transition",
    description: "A glowing line along the soft edge of a mask. Blend it on top with Add or Screen.",
    inputs: [
      { id: "mask", label: "Mask", type: "float", default: 0, min: 0, max: 1 },
      { id: "color", label: "Color", type: "color", default: [1, 0.6, 0.1, 1], widget: "swatch" },
      { id: "intensity", label: "Intensity", type: "float", default: 1.5, min: 0, max: 5 },
      { id: "sharpness", label: "Sharpness", type: "float", default: 2, min: 0.5, max: 10 },
    ],
    outputs: [{ id: "image", label: "Glow", type: "color" }],
    emit: (c) => ({
      image: `float m = clamp(${c.in("mask")}, 0.0, 1.0);
    float band = pow(1.0 - abs(m * 2.0 - 1.0), ${c.in("sharpness")});
    return vec4(${c.in("color")}.rgb * band * ${c.in("intensity")}, band);`,
    }),
  },
  {
    type: "push",
    label: "Push / Slide",
    category: "transition",
    description: "The new clip slides in and shoves the old one out (or slides over it).",
    kinds: ["transition"],
    inputs: [
      { id: "from", label: "From", type: "color", default: [0, 0, 0, 1] },
      { id: "to", label: "To", type: "color", default: [1, 1, 1, 1] },
      progress,
    ],
    options: [
      {
        id: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "left", label: "Towards the left" },
          { value: "right", label: "Towards the right" },
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" },
        ],
        default: "left",
      },
      { id: "cover", label: "Slide over instead of pushing", kind: "toggle", default: false },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      const dir: Record<string, string> = {
        left: "vec2(-1.0, 0.0)",
        right: "vec2(1.0, 0.0)",
        up: "vec2(0.0, -1.0)",
        down: "vec2(0.0, 1.0)",
      }
      const d = dir[c.opt<string>("direction")] ?? dir.left
      const cover = c.opt<boolean>("cover")
      return {
        image: `vec2 d = ${d};
    float p = clamp(${c.in("p")}, 0.0, 1.0);
    vec2 pt = uv - d * (p - 1.0);
    if (pt.x >= 0.0 && pt.x <= 1.0 && pt.y >= 0.0 && pt.y <= 1.0) return ${c.in("to", "pt")};
    vec2 pf = ${cover ? "uv" : "uv - d * p"};
    return ${c.in("from", "clamp(pf, 0.0, 1.0)")};`,
      }
    },
  },
]
