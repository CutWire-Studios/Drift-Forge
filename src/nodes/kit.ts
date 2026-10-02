import type { EmitCtx, InputDef, NodeDef } from "./types"

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
const point = (id: string, label: string, def: [number, number]): InputDef => ({
  id,
  label,
  type: "vec2",
  default: def,
  min: 0,
  max: 1,
  widget: "point",
})
const clockIn: InputDef = { id: "t", label: "Time", type: "float", default: 0, clock: true }
const progressIn: InputDef = { id: "p", label: "Progress", type: "float", default: 0, clock: true }
const seedIn: InputDef = { id: "seed", label: "Seed", type: "float", default: 0, min: 0, max: 1000, widget: "seed" }
const aspect = (c: EmitCtx) => `float asp = ${c.res()}.x / max(${c.res()}.y, 1.0);`

export const kitDistortNodes: NodeDef[] = [
  {
    type: "corner_pin",
    label: "Corner pin",
    category: "distort",
    description: "Drag the four corners anywhere to fit the picture onto a screen, sign or poster.",
    inputs: [
      image,
      point("tl", "Top-left", [0.1, 0.1]),
      point("tr", "Top-right", [0.9, 0.05]),
      point("br", "Bottom-right", [0.95, 0.9]),
      point("bl", "Bottom-left", [0.05, 0.95]),
    ],
    outputs: out,
    emit: (c) => {
      c.helper("invBilinear")
      return {
        image: `vec2 q = invBilinear(uv, ${c.in("tl")}, ${c.in("tr")}, ${c.in("br")}, ${c.in("bl")});
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    return ${c.in("image", "q")};`,
      }
    },
  },
  {
    type: "polar",
    label: "Polar coordinates",
    category: "distort",
    description: "Bend the picture into a circle (tiny planet), or unroll a circle into a strip. Great for tunnels.",
    inputs: [
      image,
      point("center", "Centre", [0.5, 0.5]),
      f("rotation", "Rotation", 0, -360, 360, { widget: "angle" }),
      f("zoom", "Zoom", 1, 0.1, 4),
      f("repeat", "Repeat", 1, 1, 12, { integer: true }),
    ],
    options: [
      {
        id: "mode",
        label: "Direction",
        kind: "select",
        options: [
          { value: "wrap", label: "Wrap into a circle" },
          { value: "unwrap", label: "Unroll a circle" },
        ],
        default: "wrap",
      },
    ],
    outputs: out,
    emit: (c) => {
      const wrap = c.opt<string>("mode") !== "unwrap"
      return {
        image: wrap
          ? `${aspect(c)}
    vec2 d = (uv - ${c.in("center")}) * vec2(asp, 1.0);
    float r = length(d) * 2.0 / max(${c.in("zoom")}, 0.0001);
    float a = atan(d.y, d.x) / 6.2831853 + 0.5 + ${c.in("rotation")} / 360.0;
    return ${c.in("image", `vec2(fract(a * max(floor(${c.in("repeat")}), 1.0)), clamp(1.0 - r, 0.0, 1.0))`)};`
          : `${aspect(c)}
    float a = (uv.x * max(floor(${c.in("repeat")}), 1.0) - 0.5 - ${c.in("rotation")} / 360.0) * 6.2831853;
    float r = (1.0 - uv.y) * ${c.in("zoom")} * 0.5;
    vec2 p = ${c.in("center")} + vec2(cos(a), sin(a)) * r / vec2(asp, 1.0);
    return ${c.in("image", "clamp(p, 0.0, 1.0)")};`,
      }
    },
  },
  {
    type: "hex_pixelate",
    label: "Hex mosaic",
    category: "distort",
    description: "Turn the picture into honeycomb tiles.",
    inputs: [image, f("size", "Tile size (px)", 24, 3, 200, { unit: "px" })],
    outputs: out,
    emit: (c) => ({
      image: `${aspect(c)}
    float cs = max(${c.in("size")}, 1.0) / ${c.res()}.y;
    vec2 p = uv * vec2(asp, 1.0) / cs;
    vec2 s = vec2(1.0, 1.7320508);
    vec2 a = mod(p, s) - s * 0.5;
    vec2 b = mod(p - s * 0.5, s) - s * 0.5;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = (p - g) * cs / vec2(asp, 1.0);
    return ${c.in("image", "clamp(q, 0.0, 1.0)")};`,
    }),
  },
]

export const kitBlurNodes: NodeDef[] = [
  {
    type: "spin_blur",
    label: "Spin blur",
    category: "blur",
    description: "Blur in a circle around a point, like the camera spinning.",
    inputs: [image, f("angle", "Spin", 10, 0, 90, { widget: "angle" }), point("center", "Centre", [0.5, 0.5])],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => {
      c.helper("rot2")
      return {
        image: `${aspect(c)}
    vec2 ctr = ${c.in("center")};
    vec2 d = (uv - ctr) * vec2(asp, 1.0);
    vec4 sum = vec4(0.0);
    for (int k = 0; k < 24; ++k) {
        float a = radians(${c.in("angle")}) * (float(k) / 23.0 - 0.5);
        vec2 q = rot2(a) * d;
        sum += ${c.in("image", "ctr + vec2(q.x / asp, q.y)")};
    }
    return sum / 24.0;`,
      }
    },
  },
  {
    type: "lens_blur",
    label: "Lens blur (bokeh)",
    category: "blur",
    description: "Out-of-focus blur like a real lens, where bright lights become soft discs.",
    inputs: [
      image,
      f("radius", "Radius (px)", 12, 0, 60, { unit: "px" }),
      f("boost", "Highlight discs", 1.5, 0, 6),
    ],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => {
      c.helper("luma")
      return {
        image: `float r = max(${c.in("radius")}, 0.0);
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 64; ++i) {
        float fi = float(i);
        float rr = sqrt((fi + 0.5) / 64.0) * r;
        float a = fi * 2.39996323;
        vec4 s = ${c.in("image", "uv + vec2(cos(a), sin(a)) * rr / " + c.res())};
        float w = 1.0 + ${c.in("boost")} * pow(luma(s), 4.0) * 8.0;
        acc += s * w;
        wsum += w;
    }
    return acc / wsum;`,
      }
    },
  },
  {
    type: "streaks",
    label: "Star streaks",
    category: "blur",
    description: "Bright points flare into star-shaped spikes, like a star filter or sparkle.",
    inputs: [
      image,
      f("threshold", "Threshold", 0.7, 0, 1),
      f("length", "Length (px)", 60, 1, 300, { unit: "px" }),
      f("points", "Spikes", 4, 1, 8, { integer: true }),
      f("rotation", "Rotation", 45, 0, 180, { widget: "angle" }),
      f("intensity", "Intensity", 1.5, 0, 5),
      { id: "tint", label: "Tint", type: "color", default: [1, 0.95, 0.85, 1], widget: "swatch" },
    ],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => ({
      image: `vec4 col = ${c.in("image")};
    vec3 sum = vec3(0.0);
    float n = clamp(floor(${c.in("points")}), 1.0, 8.0);
    float thr = ${c.in("threshold")};
    for (int i = 0; i < 8; ++i) {
        if (float(i) >= n) break;
        float a = radians(${c.in("rotation")}) + float(i) * 3.14159265 / n;
        vec2 dir = vec2(cos(a), sin(a)) * ${c.in("length")} / ${c.res()};
        for (int k = 1; k <= 12; ++k) {
            float t = float(k) / 12.0;
            float w = (1.0 - t) * (1.0 - t);
            sum += (max(${c.in("image", "uv + dir * t")}.rgb - thr, 0.0) + max(${c.in("image", "uv - dir * t")}.rgb - thr, 0.0)) * w;
        }
    }
    sum /= n * 4.0 * max(1.0 - thr, 0.05);
    return vec4(clamp(col.rgb + sum * ${c.in("intensity")} * ${c.in("tint")}.rgb, 0.0, 1.0), col.a);`,
    }),
  },
  {
    type: "emboss",
    label: "Emboss",
    category: "stylize",
    description: "Raised, stamped-metal look from the picture's edges.",
    inputs: [image, f("strength", "Strength", 2, 0, 10), f("angle", "Light angle", 135, 0, 360, { widget: "angle" })],
    options: [{ id: "keep", label: "Keep colours", kind: "toggle", default: false }],
    outputs: out,
    emit: (c) => {
      c.helper("luma")
      return {
        image: `vec4 col = ${c.in("image")};
    float a = radians(${c.in("angle")});
    vec2 d = vec2(cos(a), sin(a)) * 1.5 / ${c.res()};
    float e = (luma(${c.in("image", "uv + d")}) - luma(${c.in("image", "uv - d")})) * ${c.in("strength")};
    return vec4(clamp(${c.opt<boolean>("keep") ? "col.rgb + e" : "vec3(0.5 + e)"}, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "oil_paint",
    label: "Oil paint",
    category: "stylize",
    description: "Smooth flat areas with crisp edges, like brush strokes.",
    inputs: [image, f("radius", "Brush size (px)", 4, 1, 6, { unit: "px" })],
    outputs: out,
    heavyInputs: ["image"],
    emit: (c) => ({
      image: `float r = clamp(${c.in("radius")}, 1.0, 6.0);
    vec3 m0 = vec3(0.0); vec3 m1 = vec3(0.0); vec3 m2 = vec3(0.0); vec3 m3 = vec3(0.0);
    vec3 q0 = vec3(0.0); vec3 q1 = vec3(0.0); vec3 q2 = vec3(0.0); vec3 q3 = vec3(0.0);
    float n0 = 0.0; float n1 = 0.0; float n2 = 0.0; float n3 = 0.0;
    for (int j = -6; j <= 6; ++j) {
        for (int i = -6; i <= 6; ++i) {
            if (abs(float(i)) > r || abs(float(j)) > r) continue;
            vec3 s = ${c.in("image", "uv + vec2(float(i), float(j)) / " + c.res())}.rgb;
            if (i <= 0 && j <= 0) { m0 += s; q0 += s * s; n0 += 1.0; }
            if (i >= 0 && j <= 0) { m1 += s; q1 += s * s; n1 += 1.0; }
            if (i <= 0 && j >= 0) { m2 += s; q2 += s * s; n2 += 1.0; }
            if (i >= 0 && j >= 0) { m3 += s; q3 += s * s; n3 += 1.0; }
        }
    }
    m0 /= n0; m1 /= n1; m2 /= n2; m3 /= n3;
    vec3 v0 = q0 / n0 - m0 * m0; vec3 v1 = q1 / n1 - m1 * m1;
    vec3 v2 = q2 / n2 - m2 * m2; vec3 v3 = q3 / n3 - m3 * m3;
    float s0 = v0.r + v0.g + v0.b; float s1 = v1.r + v1.g + v1.b;
    float s2 = v2.r + v2.g + v2.b; float s3 = v3.r + v3.g + v3.b;
    vec3 best = m0; float bv = s0;
    if (s1 < bv) { best = m1; bv = s1; }
    if (s2 < bv) { best = m2; bv = s2; }
    if (s3 < bv) { best = m3; }
    return vec4(best, ${c.in("image")}.a);`,
    }),
  },
]

export const kitOverlayNodes: NodeDef[] = [
  {
    type: "rain",
    label: "Rain",
    category: "generate",
    description: "Falling rain streaks. Outputs a mask; blend it over the picture with Screen or Add.",
    inputs: [
      f("amount", "Amount", 0.5, 0, 1),
      f("speed", "Speed", 1.5, 0, 5),
      f("length", "Streak length", 0.08, 0.01, 0.3),
      f("angle", "Slant", 10, -45, 45, { widget: "angle" }),
      clockIn,
      seedIn,
    ],
    outputs: [{ id: "mask", label: "Rain", type: "float" }],
    emit: (c) => {
      c.helper("hash11")
      c.helper("rot2")
      return {
        mask: `${aspect(c)}
    vec2 q = rot2(radians(${c.in("angle")})) * ((uv - 0.5) * vec2(asp, 1.0));
    float acc = 0.0;
    for (int l = 0; l < 3; ++l) {
        float fl = float(l);
        float cols = 80.0 + fl * 60.0;
        float x = q.x * cols;
        float col = floor(x);
        float h = hash11(col * 1.37 + fl * 91.7 + ${c.in("seed")});
        if (h > ${c.in("amount")}) continue;
        float y = q.y + ${c.in("t")} * ${c.in("speed")} * (1.2 + fl * 0.5 + h) + hash11(col + 5.1) * 7.0;
        float seg = fract(y / (${c.in("length")} * (3.0 + fl)));
        float streak = smoothstep(0.0, 0.2, seg) * (1.0 - smoothstep(0.25, 0.3, seg));
        float thin = 1.0 - smoothstep(0.05, 0.25, abs(fract(x) - 0.5));
        acc += streak * thin * (0.5 + fl * 0.25);
    }
    return clamp(acc, 0.0, 1.0);`,
      }
    },
  },
  {
    type: "snow",
    label: "Snow",
    category: "generate",
    description: "Drifting snowflakes. Outputs a mask; blend it over the picture with Screen.",
    inputs: [
      f("amount", "Amount", 0.5, 0, 1),
      f("size", "Flake size", 1, 0.2, 4),
      f("speed", "Speed", 0.3, 0, 2),
      clockIn,
      seedIn,
    ],
    outputs: [{ id: "mask", label: "Snow", type: "float" }],
    emit: (c) => {
      c.helper("hash22")
      return {
        mask: `${aspect(c)}
    vec2 base = uv * vec2(asp, 1.0);
    float acc = 0.0;
    for (int l = 0; l < 4; ++l) {
        float fl = float(l);
        float scale = 6.0 + fl * 5.0;
        vec2 p = base * scale;
        p.y -= ${c.in("t")} * ${c.in("speed")} * scale * (0.6 + fl * 0.15);
        p.x += sin(p.y * 0.4 + fl * 3.0 + ${c.in("t")}) * 0.4;
        vec2 cell = floor(p);
        vec2 h = hash22(cell + fl * 17.0 + ${c.in("seed")});
        if (h.x > ${c.in("amount")}) continue;
        vec2 ctr = cell + 0.2 + h * 0.6;
        float r = (0.04 + h.y * 0.06) * ${c.in("size")} * (1.0 + fl * 0.3);
        acc += 1.0 - smoothstep(r * 0.4, r, length(p - ctr));
    }
    return clamp(acc, 0.0, 1.0);`,
      }
    },
  },
  {
    type: "film_damage",
    label: "Old film",
    category: "stylize",
    description: "Scratches, dust, gate weave and flicker, like worn projector film.",
    inputs: [
      image,
      f("scratches", "Scratches", 0.5, 0, 1),
      f("dust", "Dust", 0.5, 0, 1),
      f("flicker", "Flicker", 0.3, 0, 1),
      f("weave", "Gate weave", 0.3, 0, 1),
      clockIn,
      seedIn,
    ],
    outputs: out,
    emit: (c) => {
      c.helper("hash11")
      c.helper("hash21")
      return {
        image: `float frame = floor(${c.in("t")} * 18.0) + ${c.in("seed")} * 7.0;
    vec2 jitter = (vec2(hash11(frame), hash11(frame + 3.3)) - 0.5) * 0.006 * ${c.in("weave")};
    vec4 col = ${c.in("image", "clamp(uv + jitter, 0.0, 1.0)")};
    float fl = 1.0 + (hash11(frame + 9.1) - 0.5) * 0.3 * ${c.in("flicker")};
    vec3 rgb = col.rgb * fl;
    for (int i = 0; i < 3; ++i) {
        float fi = float(i);
        float on = step(1.0 - ${c.in("scratches")} * 0.6, hash11(frame * 1.7 + fi * 11.0));
        float x = hash11(frame + fi * 5.7);
        float line = 1.0 - smoothstep(0.0, 0.0015, abs(uv.x - x - sin(uv.y * 9.0 + fi) * 0.003));
        rgb = mix(rgb, vec3(0.9), line * on * 0.7);
    }
    vec2 cell = floor(uv * vec2(${c.res()}.x / max(${c.res()}.y, 1.0), 1.0) * 60.0);
    float speck = step(1.0 - ${c.in("dust")} * 0.02, hash21(cell + frame * 13.0));
    rgb = mix(rgb, vec3(0.05), speck * 0.85);
    return vec4(clamp(rgb, 0.0, 1.0), col.a);`,
      }
    },
  },
  {
    type: "grid_cells",
    label: "Grid cells",
    category: "generate",
    description:
      "Splits the frame into tiles and gives each one a random number, its position and a local 0–1 position. The base for tile, puzzle and random-square transitions.",
    inputs: [
      { id: "count", label: "Tiles", type: "vec2", default: [8, 5], min: 1, max: 64 },
      seedIn,
    ],
    outputs: [
      { id: "random", label: "Random per tile", type: "float" },
      { id: "order", label: "Diagonal order", type: "float" },
      { id: "checker", label: "Checker", type: "float" },
      { id: "cell", label: "Tile position", type: "vec2" },
      { id: "local", label: "Inside tile", type: "vec2" },
    ],
    emit: (c) => {
      c.helper("hash21")
      const g = `vec2 n = max(floor(${c.in("count")}), vec2(1.0));
    vec2 id = floor(uv * n);`
      return {
        random: `${g}
    return hash21(id + ${c.in("seed")} * 1.31);`,
        order: `${g}
    return (id.x + id.y) / max(n.x + n.y - 2.0, 1.0);`,
        checker: `${g}
    return mod(id.x + id.y, 2.0);`,
        cell: `${g}
    return (id + 0.5) / n;`,
        local: `${g}
    return fract(uv * n);`,
      }
    },
  },
]

/** 1 where the incoming clip shows, sweeping a 0..1 field `x` as progress runs 0..1. */
const sweep = (x: string, p: string, soft: string) =>
  `float s = max(${soft}, 0.0001);
    float front = mix(-s, 1.0 + s, ${p});
    return 1.0 - smoothstep(front - s, front + s, ${x});`

export const kitTransitionNodes: NodeDef[] = [
  {
    type: "reveal",
    label: "Reveal by pattern",
    category: "transition",
    description:
      "Turns any pattern into a transition: dark parts of the pattern switch first, bright parts last. Plug in a gradient, noise, shape, brightness or grid tiles.",
    inputs: [
      f("pattern", "Pattern", 0.5, 0, 1),
      f("softness", "Softness", 0.05, 0, 0.5),
      progressIn,
    ],
    options: [{ id: "invert", label: "Bright parts first", kind: "toggle", default: false }],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `float x = clamp(${c.in("pattern")}, 0.0, 1.0);
    ${c.opt<boolean>("invert") ? "x = 1.0 - x;" : ""}
    ${sweep("x", c.in("p"), c.in("softness"))}`,
    }),
  },
  {
    type: "clock_wipe",
    label: "Clock wipe",
    category: "transition",
    description: "A hand sweeps around like a clock, revealing the new clip.",
    kinds: ["transition"],
    inputs: [
      point("center", "Centre", [0.5, 0.5]),
      f("start", "Start angle", 0, 0, 360, { widget: "angle" }),
      f("softness", "Softness", 0.01, 0, 0.2),
      progressIn,
    ],
    options: [{ id: "ccw", label: "Anticlockwise", kind: "toggle", default: false }],
    outputs: [{ id: "mask", label: "Mask", type: "float" }],
    emit: (c) => ({
      mask: `${aspect(c)}
    vec2 d = (uv - ${c.in("center")}) * vec2(asp, 1.0);
    float a = fract((atan(d.x, -d.y) - radians(${c.in("start")})) / 6.2831853);
    ${c.opt<boolean>("ccw") ? "a = 1.0 - a;" : ""}
    ${sweep("a", c.in("p"), c.in("softness"))}`,
    }),
  },
  {
    type: "dip",
    label: "Dip to colour",
    category: "transition",
    description: "Fade out to a colour (black, white, anything), then fade in the new clip.",
    kinds: ["transition"],
    inputs: [
      { id: "from", label: "From", type: "color", default: [0, 0, 0, 1] },
      { id: "to", label: "To", type: "color", default: [1, 1, 1, 1] },
      { id: "color", label: "Colour", type: "color", default: [0, 0, 0, 1], widget: "swatch" },
      f("hold", "Hold", 0.1, 0, 0.8),
      progressIn,
    ],
    outputs: out,
    emit: (c) => ({
      image: `float p = clamp(${c.in("p")}, 0.0, 1.0);
    float h = ${c.in("hold")} * 0.5;
    vec4 dip = vec4(${c.in("color")}.rgb, 1.0);
    if (p < 0.5 - h) return mix(${c.in("from")}, dip, smoothstep(0.0, 0.5 - h, p));
    if (p > 0.5 + h) return mix(dip, ${c.in("to")}, smoothstep(0.5 + h, 1.0, p));
    return dip;`,
    }),
  },
]
