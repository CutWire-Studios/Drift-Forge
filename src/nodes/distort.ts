import type { EmitCtx, InputDef, NodeDef, OptionDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]
const center: InputDef = {
  id: "center",
  label: "Centre",
  type: "vec2",
  default: [0.5, 0.5],
  min: 0,
  max: 1,
  widget: "point",
}

const edge: OptionDef = {
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
}

/** Statements that sample `image` at the vec2 variable `p` and return it, honouring `edge`. */
function sampleAt(c: EmitCtx, p = "p"): string {
  switch (c.opt<string>("edge")) {
    case "transparent":
      return `if (${p}.x < 0.0 || ${p}.x > 1.0 || ${p}.y < 0.0 || ${p}.y > 1.0) return vec4(0.0);
    return ${c.in("image", p)};`
    case "repeat":
      return `return ${c.in("image", `fract(${p})`)};`
    case "mirror":
      return `return ${c.in("image", `1.0 - abs(mod(${p}, 2.0) - 1.0)`)};`
    default:
      return `return ${c.in("image", `clamp(${p}, 0.0, 1.0)`)};`
  }
}

const aspect = (c: EmitCtx) => `float asp = ${c.res()}.x / max(${c.res()}.y, 1.0);`

export const distortNodes: NodeDef[] = [
  {
    type: "transform",
    label: "Move / Scale / Rotate",
    category: "distort",
    description: "Move, resize and spin the picture.",
    inputs: [
      image,
      { id: "offset", label: "Move", type: "vec2", default: [0, 0], min: -1, max: 1 },
      { id: "scale", label: "Scale", type: "float", default: 1, min: 0.05, max: 5 },
      { id: "rotation", label: "Rotation", type: "float", default: 0, min: -360, max: 360, widget: "angle" },
      { ...center, id: "pivot", label: "Pivot" },
    ],
    options: [edge],
    outputs: out,
    emit: (c) => {
      c.helper("rot2")
      return {
        image: `${aspect(c)}
    vec2 p = uv - ${c.in("offset")} - ${c.in("pivot")};
    p.x *= asp;
    p = rot2(-radians(${c.in("rotation")})) * p;
    p /= max(${c.in("scale")}, 0.0001);
    p.x /= asp;
    p += ${c.in("pivot")};
    ${sampleAt(c)}`,
      }
    },
  },
  {
    type: "zoom",
    label: "Zoom",
    category: "distort",
    description: "Zoom in or out around a point.",
    inputs: [image, { id: "amount", label: "Zoom", type: "float", default: 1.5, min: 0.1, max: 8 }, center],
    options: [edge],
    outputs: out,
    emit: (c) => ({
      image: `vec2 p = (uv - ${c.in("center")}) / max(${c.in("amount")}, 0.0001) + ${c.in("center")};
    ${sampleAt(c)}`,
    }),
  },
  {
    type: "twirl",
    label: "Twirl",
    category: "distort",
    description: "Swirl the picture around a point like water down a drain.",
    inputs: [
      image,
      { id: "angle", label: "Twist", type: "float", default: 2, min: -6.28, max: 6.28 },
      { id: "radius", label: "Radius", type: "float", default: 0.45, min: 0, max: 1.5 },
      center,
    ],
    options: [edge],
    outputs: out,
    emit: (c) => ({
      image: `${aspect(c)}
    vec2 ctr = ${c.in("center")};
    vec2 d = (uv - ctr) * vec2(asp, 1.0);
    float r = length(d);
    float fall = 1.0 - smoothstep(0.0, max(${c.in("radius")}, 0.0001), r);
    float a = atan(d.y, d.x) + ${c.in("angle")} * fall * fall;
    vec2 nd = r > 1e-6 ? vec2(cos(a), sin(a)) * r : d;
    vec2 p = ctr + vec2(nd.x / asp, nd.y);
    ${sampleAt(c)}`,
    }),
  },
  {
    type: "wave",
    label: "Wave",
    category: "distort",
    description: "Ripple the picture side to side or up and down.",
    inputs: [
      image,
      { id: "amplitude", label: "Strength", type: "float", default: 0.02, min: 0, max: 0.2 },
      { id: "frequency", label: "Waves", type: "float", default: 10, min: 0, max: 60 },
      { id: "speed", label: "Speed", type: "float", default: 2, min: -20, max: 20 },
      { id: "t", label: "Time", type: "float", default: 0, clock: true },
    ],
    options: [
      {
        id: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "x", label: "Side to side" },
          { value: "y", label: "Up and down" },
          { value: "xy", label: "Both" },
        ],
        default: "x",
      },
      edge,
    ],
    outputs: out,
    emit: (c) => {
      const dir = c.opt<string>("direction")
      const ph = `${c.in("t")} * ${c.in("speed")}`
      const dx = `sin(uv.y * ${c.in("frequency")} * 6.2832 + ${ph}) * ${c.in("amplitude")}`
      const dy = `sin(uv.x * ${c.in("frequency")} * 6.2832 + ${ph}) * ${c.in("amplitude")}`
      const off = dir === "x" ? `vec2(${dx}, 0.0)` : dir === "y" ? `vec2(0.0, ${dy})` : `vec2(${dx}, ${dy})`
      return {
        image: `vec2 p = uv + ${off};
    ${sampleAt(c)}`,
      }
    },
  },
  {
    type: "ripple",
    label: "Ripple",
    category: "distort",
    description: "Rings spreading out from a point, like a stone dropped in a pond.",
    inputs: [
      image,
      { id: "amplitude", label: "Strength", type: "float", default: 0.015, min: 0, max: 0.1 },
      { id: "frequency", label: "Rings", type: "float", default: 30, min: 1, max: 100 },
      { id: "speed", label: "Speed", type: "float", default: 4, min: -20, max: 20 },
      center,
      { id: "t", label: "Time", type: "float", default: 0, clock: true },
    ],
    options: [edge],
    outputs: out,
    emit: (c) => ({
      image: `${aspect(c)}
    vec2 d = (uv - ${c.in("center")}) * vec2(asp, 1.0);
    float r = length(d);
    vec2 dir = r > 1e-5 ? d / r : vec2(0.0);
    float w = sin(r * ${c.in("frequency")} - ${c.in("t")} * ${c.in("speed")}) * ${c.in("amplitude")};
    vec2 p = uv + vec2(dir.x / asp, dir.y) * w;
    ${sampleAt(c)}`,
    }),
  },
  {
    type: "pixelate",
    label: "Pixelate",
    category: "distort",
    description: "Big chunky pixels.",
    inputs: [image, { id: "size", label: "Pixel size", type: "float", default: 16, min: 1, max: 200 }],
    outputs: out,
    emit: (c) => ({
      image: `vec2 cell = max(${c.in("size")}, 1.0) / ${c.res()};
    vec2 p = (floor(uv / cell) + 0.5) * cell;
    return ${c.in("image", "clamp(p, 0.0, 1.0)")};`,
    }),
  },
  {
    type: "mirror",
    label: "Mirror",
    category: "distort",
    description: "Reflect one half of the picture onto the other.",
    inputs: [image],
    options: [
      {
        id: "mode",
        label: "Reflect",
        kind: "select",
        options: [
          { value: "lr", label: "Left onto right" },
          { value: "rl", label: "Right onto left" },
          { value: "tb", label: "Top onto bottom" },
          { value: "bt", label: "Bottom onto top" },
          { value: "quad", label: "Four ways" },
        ],
        default: "lr",
      },
    ],
    outputs: out,
    emit: (c) => {
      const m = c.opt<string>("mode")
      const p =
        m === "lr"
          ? "vec2(0.5 - abs(uv.x - 0.5), uv.y)"
          : m === "rl"
            ? "vec2(0.5 + abs(uv.x - 0.5), uv.y)"
            : m === "tb"
              ? "vec2(uv.x, 0.5 - abs(uv.y - 0.5))"
              : m === "bt"
                ? "vec2(uv.x, 0.5 + abs(uv.y - 0.5))"
                : "0.5 - abs(uv - 0.5)"
      return { image: `return ${c.in("image", p)};` }
    },
  },
  {
    type: "kaleidoscope",
    label: "Kaleidoscope",
    category: "distort",
    description: "Fold the picture into mirrored slices around a point.",
    inputs: [
      image,
      { id: "segments", label: "Slices", type: "float", default: 6, min: 2, max: 24, integer: true },
      { id: "rotation", label: "Rotation", type: "float", default: 0, min: -360, max: 360, widget: "angle" },
      center,
    ],
    outputs: out,
    emit: (c) => ({
      image: `${aspect(c)}
    vec2 ctr = ${c.in("center")};
    vec2 d = (uv - ctr) * vec2(asp, 1.0);
    float seg = 6.2832 / max(floor(${c.in("segments")}), 2.0);
    float a = atan(d.y, d.x) + radians(${c.in("rotation")});
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    vec2 nd = vec2(cos(a), sin(a)) * length(d);
    vec2 p = ctr + vec2(nd.x / asp, nd.y);
    return ${c.in("image", "1.0 - abs(mod(p, 2.0) - 1.0)")};`,
    }),
  },
  {
    type: "lens",
    label: "Fisheye / Lens",
    category: "distort",
    description: "Bulge the middle out (fisheye) or pinch it in.",
    inputs: [
      image,
      { id: "amount", label: "Bulge", type: "float", default: 0.5, min: -1, max: 2 },
      center,
      { id: "area", label: "Area", type: "float", default: 2, min: 0.05, max: 2, hint: "Below 1 limits the bulge to a circle (spherize)." },
    ],
    options: [edge],
    outputs: out,
    emit: (c) => ({
      image: `${aspect(c)}
    vec2 ctr = ${c.in("center")};
    vec2 d = (uv - ctr) * vec2(asp, 1.0);
    float ar = max(${c.in("area")}, 0.0001);
    float inside = 1.0 - smoothstep(ar * 0.8, ar, length(d));
    float k = min(ar, 1.0);
    vec2 dn = d / k;
    d = mix(d, dn * (1.0 - ${c.in("amount")} * 0.5 + ${c.in("amount")} * dot(dn, dn)) * k, inside);
    vec2 p = ctr + vec2(d.x / asp, d.y);
    ${sampleAt(c)}`,
    }),
  },
  {
    type: "displace",
    label: "Displace",
    category: "distort",
    description: "Push pixels around using another image or noise. Red moves sideways, green moves up/down.",
    inputs: [
      image,
      { id: "map", label: "Map", type: "color", default: [0.5, 0.5, 0.5, 1] },
      { id: "strength", label: "Strength", type: "float", default: 0.05, min: 0, max: 0.5 },
    ],
    options: [edge],
    outputs: out,
    emit: (c) => ({
      image: `vec2 p = uv + (${c.in("map")}.rg - 0.5) * 2.0 * ${c.in("strength")};
    ${sampleAt(c)}`,
    }),
  },
  {
    type: "shake",
    label: "Camera shake",
    category: "distort",
    description: "Jitter the frame like a handheld camera or an impact.",
    inputs: [
      image,
      { id: "amount", label: "Strength", type: "float", default: 0.02, min: 0, max: 0.2 },
      { id: "speed", label: "Speed", type: "float", default: 12, min: 0, max: 60 },
      { id: "rotation", label: "Twist", type: "float", default: 0, min: 0, max: 20, widget: "angle" },
      { id: "t", label: "Time", type: "float", default: 0, clock: true },
      { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" },
    ],
    options: [edge],
    outputs: out,
    emit: (c) => {
      c.helper("valueNoise")
      c.helper("rot2")
      return {
        image: `float ts = ${c.in("t")} * ${c.in("speed")} + ${c.in("seed")} * 11.3;
    vec2 j = vec2(valueNoise(vec2(ts, 3.7)), valueNoise(vec2(9.1, ts))) - 0.5;
    float tw = (valueNoise(vec2(ts * 0.9, 5.3)) - 0.5) * 2.0 * radians(${c.in("rotation")});
    float asp = ${c.res()}.x / max(${c.res()}.y, 1.0);
    vec2 q = (uv - 0.5) * vec2(asp, 1.0);
    q = rot2(tw) * q;
    vec2 p = vec2(q.x / asp, q.y) / (1.0 + ${c.in("amount")} * 2.0 + abs(tw) * 0.5) + 0.5 + j * 2.0 * ${c.in("amount")};
    ${sampleAt(c)}`,
      }
    },
  },
  {
    type: "tile",
    label: "Tile",
    category: "distort",
    description: "Repeat the picture in a grid.",
    inputs: [image, { id: "count", label: "Tiles", type: "vec2", default: [2, 2], min: 1, max: 12 }],
    options: [
      { id: "mirror", label: "Mirror alternate tiles", kind: "toggle", default: false },
    ],
    outputs: out,
    emit: (c) => ({
      image: c.opt<boolean>("mirror")
        ? `vec2 p = uv * ${c.in("count")};
    return ${c.in("image", "1.0 - abs(mod(p, 2.0) - 1.0)")};`
        : `return ${c.in("image", `fract(uv * ${c.in("count")})`)};`,
    }),
  },
]
