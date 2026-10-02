import type { NodeDef } from "./types"

const f = (id: string, label: string, def = 0, min = -10, max = 10) => ({
  id,
  label,
  type: "float" as const,
  default: def,
  min,
  max,
})

export const mathNodes: NodeDef[] = [
  {
    type: "math",
    label: "Math",
    category: "math",
    description: "Combine two numbers.",
    inputs: [f("a", "A", 0), f("b", "B", 1)],
    options: [
      {
        id: "op",
        label: "Operation",
        kind: "select",
        options: [
          { value: "add", label: "A + B" },
          { value: "sub", label: "A − B" },
          { value: "mul", label: "A × B" },
          { value: "div", label: "A ÷ B" },
          { value: "min", label: "Smaller" },
          { value: "max", label: "Larger" },
          { value: "pow", label: "A to the power B" },
          { value: "mod", label: "Remainder" },
          { value: "step", label: "1 if A ≥ B" },
        ],
        default: "add",
      },
    ],
    outputs: [{ id: "value", label: "Result", type: "float" }],
    emit: (c) => {
      const a = c.in("a")
      const b = c.in("b")
      const e: Record<string, string> = {
        add: `${a} + ${b}`,
        sub: `${a} - ${b}`,
        mul: `${a} * ${b}`,
        div: `${a} / (abs(${b}) < 1e-6 ? 1e-6 : ${b})`,
        min: `min(${a}, ${b})`,
        max: `max(${a}, ${b})`,
        pow: `pow(abs(${a}), ${b})`,
        mod: `mod(${a}, ${b})`,
        step: `step(${b}, ${a})`,
      }
      return { value: `return ${e[c.opt<string>("op")] ?? e.add};` }
    },
  },
  {
    type: "func",
    label: "Function",
    category: "math",
    description: "Apply sine, absolute value, one-minus and similar to a number.",
    inputs: [f("x", "X", 0)],
    options: [
      {
        id: "fn",
        label: "Function",
        kind: "select",
        options: [
          { value: "oneminus", label: "1 − X" },
          { value: "neg", label: "−X" },
          { value: "abs", label: "Absolute" },
          { value: "sin", label: "Sine" },
          { value: "cos", label: "Cosine" },
          { value: "fract", label: "Fraction" },
          { value: "floor", label: "Round down" },
          { value: "sqrt", label: "Square root" },
          { value: "saturate", label: "Clamp 0–1" },
        ],
        default: "oneminus",
      },
    ],
    outputs: [{ id: "value", label: "Result", type: "float" }],
    emit: (c) => {
      const x = c.in("x")
      const e: Record<string, string> = {
        oneminus: `1.0 - ${x}`,
        neg: `-${x}`,
        abs: `abs(${x})`,
        sin: `sin(${x})`,
        cos: `cos(${x})`,
        fract: `fract(${x})`,
        floor: `floor(${x})`,
        sqrt: `sqrt(max(${x}, 0.0))`,
        saturate: `clamp(${x}, 0.0, 1.0)`,
      }
      return { value: `return ${e[c.opt<string>("fn")] ?? e.oneminus};` }
    },
  },
  {
    type: "remap",
    label: "Remap",
    category: "math",
    description: "Convert a number from one range to another, e.g. 0–1 into 10–50.",
    inputs: [f("x", "X", 0.5), f("inMin", "From low", 0), f("inMax", "From high", 1), f("outMin", "To low", 0), f("outMax", "To high", 1)],
    options: [{ id: "clamp", label: "Stay inside the range", kind: "toggle", default: true }],
    outputs: [{ id: "value", label: "Result", type: "float" }],
    emit: (c) => {
      const t = `(${c.in("x")} - ${c.in("inMin")}) / (${c.in("inMax")} - ${c.in("inMin")} + 1e-6)`
      return {
        value: `float t = ${c.opt<boolean>("clamp") ? `clamp(${t}, 0.0, 1.0)` : t};
    return mix(${c.in("outMin")}, ${c.in("outMax")}, t);`,
      }
    },
  },
  {
    type: "smoothstep",
    label: "Smooth step",
    category: "math",
    description: "0 below Low, 1 above High, smooth in between.",
    inputs: [f("x", "X", 0.5), f("low", "Low", 0), f("high", "High", 1)],
    outputs: [{ id: "value", label: "Result", type: "float" }],
    emit: (c) => ({ value: `return smoothstep(${c.in("low")}, max(${c.in("high")}, ${c.in("low")} + 1e-5), ${c.in("x")});` }),
  },
  {
    type: "split_color",
    label: "Split color",
    category: "math",
    description: "Pull out the red, green, blue, alpha and brightness of an image.",
    inputs: [{ id: "color", label: "Image", type: "color", default: [0, 0, 0, 1] }],
    outputs: [
      { id: "r", label: "Red", type: "float" },
      { id: "g", label: "Green", type: "float" },
      { id: "b", label: "Blue", type: "float" },
      { id: "a", label: "Alpha", type: "float" },
      { id: "l", label: "Brightness", type: "float" },
    ],
    emit: (c) => {
      c.helper("luma")
      const v = c.in("color")
      return {
        r: `return ${v}.r;`,
        g: `return ${v}.g;`,
        b: `return ${v}.b;`,
        a: `return ${v}.a;`,
        l: `return luma(${v});`,
      }
    },
  },
  {
    type: "combine_color",
    label: "Combine color",
    category: "math",
    description: "Build a colour from separate red, green, blue and alpha values.",
    inputs: [f("r", "Red", 0, 0, 1), f("g", "Green", 0, 0, 1), f("b", "Blue", 0, 0, 1), f("a", "Alpha", 1, 0, 1)],
    outputs: [{ id: "color", label: "Color", type: "color" }],
    emit: (c) => ({ color: `return vec4(${c.in("r")}, ${c.in("g")}, ${c.in("b")}, ${c.in("a")});` }),
  },
  {
    type: "split_point",
    label: "Split point",
    category: "math",
    description: "Separate a point into X and Y.",
    inputs: [{ id: "p", label: "Point", type: "vec2", default: [0, 0] }],
    outputs: [
      { id: "x", label: "X", type: "float" },
      { id: "y", label: "Y", type: "float" },
    ],
    emit: (c) => ({ x: `return ${c.in("p")}.x;`, y: `return ${c.in("p")}.y;` }),
  },
  {
    type: "combine_point",
    label: "Combine point",
    category: "math",
    description: "Make a point from X and Y.",
    inputs: [f("x", "X", 0.5, 0, 1), f("y", "Y", 0.5, 0, 1)],
    outputs: [{ id: "p", label: "Point", type: "vec2" }],
    emit: (c) => ({ p: `return vec2(${c.in("x")}, ${c.in("y")});` }),
  },
]
