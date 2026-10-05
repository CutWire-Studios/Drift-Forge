import { glslFloat } from "@/compiler/glsl"
import type { NodeDef } from "./types"

export const controlNodes: NodeDef[] = [
  {
    type: "choice",
    label: "Dropdown",
    category: "input",
    description: "A list of named choices. Outputs 0 for the first, 1 for the second… Wire it into Pick by choice.",
    cheap: true,
    inputs: [{ id: "value", label: "Choice", type: "float", default: 0, min: 0, max: 7, widget: "choice", integer: true }],
    options: [{ id: "labels", label: "Choices", kind: "labels", default: ["First", "Second", "Third"] }],
    outputs: [{ id: "value", label: "Index", type: "float" }],
    emit: (c) => ({ value: `return floor(${c.in("value")} + 0.5);` }),
  },
  {
    type: "pick",
    label: "Pick by choice",
    category: "mix",
    description: "Shows one of up to four images, chosen by a number: 0 shows the first, 1 the second…",
    inputs: [
      { id: "which", label: "Choice", type: "float", default: 0, min: 0, max: 3, integer: true },
      { id: "a", label: "Choice 0", type: "color", default: [0, 0, 0, 1] },
      { id: "b", label: "Choice 1", type: "color", default: [0, 0, 0, 1] },
      { id: "c", label: "Choice 2", type: "color", default: [0, 0, 0, 1] },
      { id: "d", label: "Choice 3", type: "color", default: [0, 0, 0, 1] },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => ({
      image: `float w = floor(${c.in("which")} + 0.5);
    if (w < 0.5) return ${c.in("a")};
    if (w < 1.5) return ${c.in("b")};
    if (w < 2.5) return ${c.in("c")};
    return ${c.in("d")};`,
    }),
  },
  {
    type: "region",
    label: "Region",
    category: "input",
    description: "A box or oval on the frame. Use the mask to blur a face, spotlight something, or limit any effect to one area.",
    inputs: [{ id: "softness", label: "Edge softness", type: "float", default: 0.02, min: 0, max: 0.3 }],
    options: [
      { id: "rect", label: "Area", kind: "region", default: [0.3, 0.25, 0.4, 0.5] },
      {
        id: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "rect", label: "Box" },
          { value: "ellipse", label: "Oval" },
        ],
        default: "ellipse",
      },
      { id: "invert", label: "Everything outside", kind: "toggle", default: false },
    ],
    outputs: [
      { id: "mask", label: "Mask", type: "float" },
      { id: "center", label: "Centre", type: "vec2" },
      { id: "size", label: "Size", type: "vec2" },
    ],
    emit: (c) => {
      const exposed = c.optParam("rect")
      const r = c.opt<number[] | object>("rect")
      const lit = Array.isArray(r) ? r : [0.3, 0.25, 0.4, 0.5]
      const rect = exposed ? `pv_${exposed}()` : `vec4(${lit.map(glslFloat).join(", ")})`
      const ellipse = c.opt<string>("shape") !== "rect"
      return {
        mask: `vec4 rg = ${rect};
    vec2 half2 = max(rg.zw * 0.5, vec2(0.0001));
    vec2 ctr = rg.xy + half2;
    ${
      ellipse
        ? "float sd = (length((uv - ctr) / half2) - 1.0) * min(half2.x, half2.y);"
        : "vec2 q = abs(uv - ctr) - half2;\n    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);"
    }
    float soft = max(${c.in("softness")}, 0.0005);
    float m = 1.0 - smoothstep(-soft, soft, sd);
    return ${c.opt<boolean>("invert") ? "1.0 - m" : "m"};`,
        center: `vec4 rg = ${rect};
    return rg.xy + rg.zw * 0.5;`,
        size: `vec4 rg = ${rect};
    return rg.zw;`,
      }
    },
  },
  {
    type: "seed",
    label: "Random seed",
    category: "input",
    description: "A number that reshuffles randomness. Expose it so each clip can get its own random pattern.",
    cheap: true,
    inputs: [{ id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" }],
    outputs: [{ id: "value", label: "Seed", type: "float" }],
    emit: (c) => ({ value: `return ${c.in("seed")};` }),
  },
  {
    type: "other_clip",
    label: "Other clip",
    category: "input",
    description: "Another clip from the timeline, chosen in Drift. For track mattes, luma mattes and displacing one clip with another.",
    next: true,
    cheap: true,
    inputs: [],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => ({ image: `return ${c.clip("uv")};` }),
  },
  {
    type: "clip_mask",
    label: "Clip mask",
    category: "input",
    description:
      "The masks on the clip in Drift, such as Cut out subject: 1 inside, 0 outside. The effect takes the mask over, so Drift stops cutting the clip out with it. In a transition, the outgoing clip's mask.",
    next: true,
    cheap: true,
    inputs: [],
    outputs: [
      { id: "mask", label: "Mask", type: "float" },
      { id: "has", label: "Has a mask", type: "float" },
    ],
    emit: (c) => ({ mask: `return ${c.mask("uv")};`, has: `return ${c.hasMask()};` }),
  },
  {
    type: "audio",
    label: "Music",
    category: "input",
    description: "Follows the music: overall loudness, bass, and a pulse on every beat. Each runs 0 to 1.",
    next: true,
    cheap: true,
    inputs: [],
    outputs: [
      { id: "level", label: "Loudness", type: "float" },
      { id: "bass", label: "Bass", type: "float" },
      { id: "beat", label: "Beat pulse", type: "float" },
    ],
    emit: (c) => ({
      level: `return ${c.engine("u_audioLevel")};`,
      bass: `return ${c.engine("u_audioBass")};`,
      beat: `return ${c.engine("u_audioBeat")};`,
    }),
  },
]
