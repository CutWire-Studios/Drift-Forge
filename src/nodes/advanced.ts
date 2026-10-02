import type { NodeDef } from "./types"

export const CUSTOM_DEFAULT = `// Write GLSL that returns a vec4 colour.
// Available: uv (vec2, 0..1, top-left origin), IN1(p) and IN2(p) sample the
// two image inputs at any position, a b c d are the number inputs,
// RESOLUTION is the frame size in pixels, and TIME (effects) or
// PROGRESS (transitions) is the clock.
vec4 col = IN1(uv);
col.rgb = mix(col.rgb, col.bgr, a);
return col;`

export const advancedNodes: NodeDef[] = [
  {
    type: "custom",
    label: "Custom GLSL",
    category: "advanced",
    description: "Write your own shader code. For people who know GLSL.",
    inputs: [
      { id: "in1", label: "Image 1", type: "color", default: [0, 0, 0, 1] },
      { id: "in2", label: "Image 2", type: "color", default: [0, 0, 0, 1] },
      { id: "a", label: "a", type: "float", default: 0.5, min: 0, max: 1 },
      { id: "b", label: "b", type: "float", default: 0, min: 0, max: 1 },
      { id: "c", label: "c", type: "float", default: 0, min: 0, max: 1 },
      { id: "d", label: "d", type: "float", default: 0, min: 0, max: 1 },
    ],
    options: [
      { id: "code", label: "Code", kind: "code", default: CUSTOM_DEFAULT },
      { id: "heavy", label: "Samples the inputs many times (render them to a buffer first)", kind: "toggle", default: false },
    ],
    heavyInputs: (c) => (c.opt<boolean>("heavy") ? ["in1", "in2"] : []),
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      const p = c.prefix
      c.declare(`vec4 ${p}_in1(vec2 p) { return ${c.in("in1", "p")}; }
vec4 ${p}_in2(vec2 p) { return ${c.in("in2", "p")}; }`)
      const clock = c.kind === "effect" ? `#define TIME ${c.time()}` : `#define PROGRESS ${c.progress()}`
      return {
        image: `float a = ${c.in("a")};
    float b = ${c.in("b")};
    float c = ${c.in("c")};
    float d = ${c.in("d")};
#define IN1 ${p}_in1
#define IN2 ${p}_in2
#define RESOLUTION ${c.res()}
${clock}
${c.opt<string>("code")}
#undef IN1
#undef IN2
#undef RESOLUTION
#undef ${c.kind === "effect" ? "TIME" : "PROGRESS"}`,
      }
    },
  },
]

export const outputNodes: NodeDef[] = [
  {
    type: "effect_output",
    label: "Output",
    category: "output",
    description: "What the effect finally shows. Every effect has exactly one.",
    kinds: ["effect"],
    output: true,
    inputs: [{ id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }],
    outputs: [],
    emit: (c) => ({ image: `return ${c.in("image")};` }),
  },
  {
    type: "transition_output",
    label: "Output",
    category: "output",
    description: "What the transition finally shows. Every transition has exactly one.",
    kinds: ["transition"],
    output: true,
    inputs: [{ id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }],
    outputs: [],
    emit: (c) => ({ image: `return ${c.in("image")};` }),
  },
]
