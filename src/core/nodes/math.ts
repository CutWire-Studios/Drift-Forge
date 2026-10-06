import type { EmitCtx, InputDef, NodeDef } from "./types"

const f = (id: string, label: string, def = 0, min = -10, max = 10) => ({
  id,
  label,
  type: "float" as const,
  default: def,
  min,
  max,
})

const v = (id: string, label: string, def: [number, number], min = -2, max = 2): InputDef => ({
  id,
  label,
  type: "vec2",
  default: def,
  min,
  max,
})
const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const spacing: InputDef = {
  id: "spacing",
  label: "Step (px)",
  type: "float",
  default: 1,
  min: 0.5,
  max: 20,
  noExpose: true,
  hint: "How far apart the samples are. Larger smooths out noise and fine detail.",
}
const fieldHint = "Unconnected: the pixel's own position."

/** The input's value, or the pixel's position when nothing is wired in. */
const field = (c: EmitCtx, id: string, at = "uv") => (c.connected(id) ? c.in(id, at) : at)

/** Statements declaring `h`, a step of `spacing` pixels in uv units. */
const stepUv = (c: EmitCtx) => `vec2 h = max(${c.in("spacing")}, 0.01) / ${c.res()};`

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
          { value: "atan2", label: "Angle of (A, B)" },
          { value: "hypot", label: "Length of (A, B)" },
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
        atan2: `atan(${b}, ${a})`,
        hypot: `length(vec2(${a}, ${b}))`,
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
          { value: "square", label: "X squared" },
          { value: "tan", label: "Tangent" },
          { value: "atan", label: "Arctangent" },
          { value: "tanh", label: "Tanh (soft clip)" },
          { value: "exp", label: "e to the X" },
          { value: "log", label: "Natural log" },
          { value: "sign", label: "Sign (−1, 0, 1)" },
          { value: "round", label: "Round" },
          { value: "ceil", label: "Round up" },
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
        square: `${x} * ${x}`,
        tan: `tan(${x})`,
        atan: `atan(${x})`,
        tanh: `tanh(${x})`,
        exp: `exp(min(${x}, 80.0))`,
        log: `log(max(${x}, 1e-6))`,
        sign: `sign(${x})`,
        round: `floor(${x} + 0.5)`,
        ceil: `ceil(${x})`,
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
  {
    type: "mix_value",
    label: "Mix numbers",
    category: "math",
    description: "Blend between A and B: A at 0, B at 1, halfway at 0.5.",
    inputs: [f("a", "A", 0), f("b", "B", 1), f("t", "Amount", 0.5, 0, 1)],
    outputs: [{ id: "value", label: "Result", type: "float" }],
    emit: (c) => ({ value: `return mix(${c.in("a")}, ${c.in("b")}, ${c.in("t")});` }),
  },
  {
    type: "vector_math",
    label: "Vector math",
    category: "math",
    description: "Add, subtract, scale, rotate, reflect or project points and directions.",
    inputs: [v("a", "A", [0, 0]), v("b", "B", [0, 0]), f("s", "Amount", 1)],
    options: [
      {
        id: "op",
        label: "Operation",
        kind: "select",
        options: [
          { value: "add", label: "A + B" },
          { value: "sub", label: "A − B" },
          { value: "mul", label: "A × B (each axis)" },
          { value: "div", label: "A ÷ B (each axis)" },
          { value: "scale", label: "A × Amount" },
          { value: "rotate", label: "Rotate A by Amount (degrees)" },
          { value: "normalize", label: "Direction of A (length 1)" },
          { value: "perp", label: "A turned 90°" },
          { value: "reflect", label: "Reflect A off a surface facing B" },
          { value: "project", label: "Project A onto B" },
          { value: "lerp", label: "Blend A to B by Amount" },
          { value: "min", label: "Smaller of each axis" },
          { value: "max", label: "Larger of each axis" },
        ],
        default: "add",
      },
    ],
    outputs: [{ id: "p", label: "Result", type: "vec2" }],
    emit: (c) => {
      c.helper("rot2")
      const a = c.in("a")
      const b = c.in("b")
      const s = c.in("s")
      const e: Record<string, string> = {
        add: `${a} + ${b}`,
        sub: `${a} - ${b}`,
        mul: `${a} * ${b}`,
        div: `${a} / mix(${b}, vec2(1e-6), vec2(lessThan(abs(${b}), vec2(1e-6))))`,
        scale: `${a} * ${s}`,
        rotate: `rot2(radians(${s})) * ${a}`,
        normalize: `${a} / max(length(${a}), 1e-6)`,
        perp: `vec2(-${a}.y, ${a}.x)`,
        reflect: `reflect(${a}, ${b} / max(length(${b}), 1e-6))`,
        project: `${b} * dot(${a}, ${b}) / max(dot(${b}, ${b}), 1e-6)`,
        lerp: `mix(${a}, ${b}, ${s})`,
        min: `min(${a}, ${b})`,
        max: `max(${a}, ${b})`,
      }
      return { p: `return ${e[c.opt<string>("op")] ?? e.add};` }
    },
  },
  {
    type: "vector_measure",
    label: "Vector measure",
    category: "math",
    description: "Lengths, distances, angles and dot / cross products of two vectors.",
    inputs: [v("a", "A", [1, 0]), v("b", "B", [0, 1])],
    outputs: [
      { id: "length", label: "Length of A", type: "float" },
      { id: "distance", label: "Distance A to B", type: "float" },
      { id: "dot", label: "Dot product", type: "float" },
      { id: "cross", label: "Cross product", type: "float" },
      { id: "angle", label: "Angle of A (°)", type: "float" },
      { id: "between", label: "Angle A to B (°)", type: "float" },
    ],
    emit: (c) => {
      const a = c.in("a")
      const b = c.in("b")
      return {
        length: `return length(${a});`,
        distance: `return distance(${a}, ${b});`,
        dot: `return dot(${a}, ${b});`,
        cross: `vec2 a = ${a};\n    vec2 b = ${b};\n    return a.x * b.y - a.y * b.x;`,
        angle: `vec2 a = ${a};\n    return degrees(atan(a.y, a.x));`,
        between: `vec2 a = ${a};\n    vec2 b = ${b};\n    return degrees(atan(a.x * b.y - a.y * b.x, dot(a, b)));`,
      }
    },
  },
  {
    type: "linear_transform",
    label: "Linear transform",
    category: "math",
    description: "Multiply a point by a 2×2 matrix [[a, b], [c, d]] around an origin, then move it.",
    inputs: [
      { ...v("p", "Point", [0.5, 0.5], 0, 1), hint: fieldHint },
      f("m00", "a (x from x)", 1, -4, 4),
      f("m01", "b (x from y)", 0, -4, 4),
      f("m10", "c (y from x)", 0, -4, 4),
      f("m11", "d (y from y)", 1, -4, 4),
      v("offset", "Then move by", [0, 0], -1, 1),
      { ...v("origin", "Origin", [0.5, 0.5], 0, 1), widget: "point" },
    ],
    options: [
      { id: "inverse", label: "Apply the inverse matrix", kind: "toggle", default: false },
      { id: "square", label: "Square pixels (correct for aspect)", kind: "toggle", default: true },
    ],
    outputs: [
      { id: "p", label: "Point", type: "vec2" },
      { id: "det", label: "Determinant", type: "float" },
    ],
    emit: (c) => {
      const m = `mat2(${c.in("m00")}, ${c.in("m10")}, ${c.in("m01")}, ${c.in("m11")})`
      const sq = c.opt<boolean>("square")
      const inv = c.opt<boolean>("inverse")
      return {
        p: `mat2 M = ${m};
    ${inv ? `float det = determinant(M);\n    M = mat2(M[1][1], -M[0][1], -M[1][0], M[0][0]) / (abs(det) < 1e-6 ? 1e-6 : det);` : ""}
    float asp = ${sq ? `${c.aspect()}` : "1.0"};
    vec2 o = ${c.in("origin")};
    vec2 q = (${field(c, "p")} - o) * vec2(asp, 1.0);
    return (M * q) / vec2(asp, 1.0) + o + ${c.in("offset")};`,
        det: `return determinant(${m});`,
      }
    },
  },
  {
    type: "matrix_warp",
    label: "Matrix warp",
    category: "distort",
    description: "Shear, stretch, rotate or flip the picture with a 2×2 matrix [[a, b], [c, d]].",
    inputs: [
      image,
      f("m00", "a (x from x)", 1, -4, 4),
      f("m01", "b (x from y)", 0.3, -4, 4),
      f("m10", "c (y from x)", 0, -4, 4),
      f("m11", "d (y from y)", 1, -4, 4),
      v("offset", "Move", [0, 0], -1, 1),
      { ...v("origin", "Origin", [0.5, 0.5], 0, 1), widget: "point" },
    ],
    options: [{ id: "transparent", label: "Transparent outside the frame", kind: "toggle", default: true }],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      const outside = c.opt<boolean>("transparent")
        ? `if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);\n    `
        : ""
      // The picture moves forward by M, so each pixel reads from the inverse.
      return {
        image: `mat2 M = mat2(${c.in("m00")}, ${c.in("m10")}, ${c.in("m01")}, ${c.in("m11")});
    float det = determinant(M);
    mat2 inv = mat2(M[1][1], -M[0][1], -M[1][0], M[0][0]) / (abs(det) < 1e-6 ? 1e-6 : det);
    float asp = ${c.aspect()};
    vec2 o = ${c.in("origin")};
    vec2 p = (inv * ((uv - o - ${c.in("offset")}) * vec2(asp, 1.0))) / vec2(asp, 1.0) + o;
    ${outside}return ${c.in("image", "clamp(p, 0.0, 1.0)")};`,
      }
    },
  },
  {
    type: "sample_at",
    label: "Sample at position",
    category: "math",
    description: "Read an image at any position, e.g. one computed by Linear transform, Vector math or Complex math.",
    inputs: [image, { ...v("p", "Position", [0.5, 0.5], 0, 1), hint: fieldHint }],
    options: [
      {
        id: "edge",
        label: "Outside the frame",
        kind: "select",
        options: [
          { value: "clamp", label: "Stretch edges" },
          { value: "transparent", label: "Transparent" },
          { value: "repeat", label: "Repeat" },
          { value: "mirror", label: "Mirror" },
        ],
        default: "clamp",
      },
    ],
    outputs: [{ id: "image", label: "Image", type: "color" }],
    emit: (c) => {
      const at: Record<string, string> = {
        clamp: `return ${c.in("image", "clamp(p, 0.0, 1.0)")};`,
        transparent: `if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);\n    return ${c.in("image", "p")};`,
        repeat: `return ${c.in("image", "fract(p)")};`,
        mirror: `return ${c.in("image", "1.0 - abs(mod(p, 2.0) - 1.0)")};`,
      }
      return { image: `vec2 p = ${field(c, "p")};\n    ${at[c.opt<string>("edge")] ?? at.clamp}` }
    },
  },
  {
    type: "complex_math",
    label: "Complex math",
    category: "math",
    description:
      "Treat points as complex numbers (x + iy) around the centre of the frame. Squaring, inverting and exponentials make conformal warps when fed into Sample at position.",
    inputs: [
      { ...v("z", "Z", [0.5, 0.5], 0, 1), hint: fieldHint },
      v("w", "W", [1, 0]),
      f("n", "Power", 2, -8, 8),
      f("zoom", "Zoom", 2, 0.1, 10),
    ],
    options: [
      {
        id: "op",
        label: "Operation",
        kind: "select",
        options: [
          { value: "mul", label: "Z × W" },
          { value: "div", label: "Z ÷ W" },
          { value: "pow", label: "Z to the Power" },
          { value: "inv", label: "1 ÷ Z" },
          { value: "conj", label: "Conjugate" },
          { value: "exp", label: "e to the Z" },
          { value: "log", label: "Natural log" },
          { value: "sqrt", label: "Square root" },
          { value: "sin", label: "Sine" },
          { value: "mobius", label: "(Z − W) ÷ (1 − conj(W)·Z)" },
        ],
        default: "pow",
      },
    ],
    outputs: [
      { id: "p", label: "Position", type: "vec2" },
      { id: "abs", label: "Magnitude", type: "float" },
      { id: "arg", label: "Angle (°)", type: "float" },
    ],
    emit: (c) => {
      const pre = c.prefix
      c.declare(`vec2 ${pre}cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 ${pre}cdiv(vec2 a, vec2 b) { float d = max(dot(b, b), 1e-8); return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d; }`)
      const e: Record<string, string> = {
        mul: `${pre}cmul(z, w)`,
        div: `${pre}cdiv(z, w)`,
        pow: `pow(max(length(z), 1e-8), n) * vec2(cos(n * atan(z.y, z.x)), sin(n * atan(z.y, z.x)))`,
        inv: `${pre}cdiv(vec2(1.0, 0.0), z)`,
        conj: `vec2(z.x, -z.y)`,
        exp: `exp(min(z.x, 80.0)) * vec2(cos(z.y), sin(z.y))`,
        log: `vec2(log(max(length(z), 1e-8)), atan(z.y, z.x))`,
        sqrt: `sqrt(length(z)) * vec2(cos(0.5 * atan(z.y, z.x)), sin(0.5 * atan(z.y, z.x)))`,
        sin: `vec2(sin(z.x) * cosh(clamp(z.y, -80.0, 80.0)), cos(z.x) * sinh(clamp(z.y, -80.0, 80.0)))`,
        mobius: `${pre}cdiv(z - w, vec2(1.0, 0.0) - ${pre}cmul(vec2(w.x, -w.y), z))`,
      }
      // Frame positions map to z = (uv - 0.5) * zoom with y up and square pixels, and back after.
      const body = `float asp = ${c.aspect()};
    vec2 sc = vec2(asp, -1.0) * ${c.in("zoom")};
    vec2 z = (${field(c, "z")} - 0.5) * sc;
    vec2 w = ${c.in("w")};
    float n = ${c.in("n")};
    vec2 r = ${e[c.opt<string>("op")] ?? e.pow};`
      return {
        p: `${body}\n    return r / sc + 0.5;`,
        abs: `${body}\n    return length(r);`,
        arg: `${body}\n    return degrees(atan(r.y, r.x));`,
      }
    },
  },
  {
    type: "derivative",
    label: "Derivative",
    category: "math",
    description:
      "How fast a value changes across the frame: its slope along X and Y, the gradient direction, and the Laplacian (curvature). Measured per frame width / height.",
    inputs: [f("x", "Value", 0), spacing],
    outputs: [
      { id: "dx", label: "∂/∂x", type: "float" },
      { id: "dy", label: "∂/∂y", type: "float" },
      { id: "grad", label: "Gradient", type: "vec2" },
      { id: "slope", label: "Steepness", type: "float" },
      { id: "lap", label: "Laplacian", type: "float" },
    ],
    emit: (c) => {
      const at = (o: string) => c.in("x", `uv + ${o}`)
      const grad = `${stepUv(c)}
    vec2 g = vec2(${at("vec2(h.x, 0.0)")} - ${at("vec2(-h.x, 0.0)")}, ${at("vec2(0.0, h.y)")} - ${at("vec2(0.0, -h.y)")}) / (2.0 * h);`
      return {
        dx: `${grad}\n    return g.x;`,
        dy: `${grad}\n    return g.y;`,
        grad: `${grad}\n    return g;`,
        slope: `${grad}\n    return length(g);`,
        lap: `${stepUv(c)}
    float c0 = ${c.in("x")};
    return (${at("vec2(h.x, 0.0)")} + ${at("vec2(-h.x, 0.0)")} - 2.0 * c0) / (h.x * h.x)
         + (${at("vec2(0.0, h.y)")} + ${at("vec2(0.0, -h.y)")} - 2.0 * c0) / (h.y * h.y);`,
      }
    },
  },
  {
    type: "jacobian",
    label: "Jacobian",
    category: "math",
    description:
      "For a position field (e.g. a warp), how it stretches and turns space at each pixel: the partial derivatives, determinant (area change), divergence and curl.",
    inputs: [{ ...v("p", "Field", [0.5, 0.5], 0, 1), hint: fieldHint }, spacing],
    outputs: [
      { id: "ddx", label: "∂/∂x", type: "vec2" },
      { id: "ddy", label: "∂/∂y", type: "vec2" },
      { id: "det", label: "Determinant", type: "float" },
      { id: "div", label: "Divergence", type: "float" },
      { id: "curl", label: "Curl", type: "float" },
    ],
    emit: (c) => {
      const at = (o: string) => field(c, "p", `(uv + ${o})`)
      const J = `${stepUv(c)}
    vec2 jx = (${at("vec2(h.x, 0.0)")} - ${at("vec2(-h.x, 0.0)")}) / (2.0 * h.x);
    vec2 jy = (${at("vec2(0.0, h.y)")} - ${at("vec2(0.0, -h.y)")}) / (2.0 * h.y);`
      return {
        ddx: `${J}\n    return jx;`,
        ddy: `${J}\n    return jy;`,
        det: `${J}\n    return jx.x * jy.y - jy.x * jx.y;`,
        div: `${J}\n    return jx.x + jy.y;`,
        curl: `${J}\n    return jx.y - jy.x;`,
      }
    },
  },
]
