import type { EmitCtx, InputDef, NodeDef } from "./types"

const image: InputDef = { id: "image", label: "Image", type: "color", default: [0, 0, 0, 1] }
const fromIn: InputDef = { id: "from", label: "From", type: "color", default: [0, 0, 0, 1] }
const toIn: InputDef = { id: "to", label: "To", type: "color", default: [1, 1, 1, 1] }
const out = [{ id: "image", label: "Image", type: "color" as const }]
const progressIn: InputDef = { id: "p", label: "Progress", type: "float", default: 0, clock: true }
const angle = (id: string, label: string, def = 0, min = -180, max = 180): InputDef => ({
  id,
  label,
  type: "float",
  default: def,
  min,
  max,
  widget: "angle",
})
const perspective: InputDef = {
  id: "perspective",
  label: "Perspective",
  type: "float",
  default: 1,
  min: 0.1,
  max: 3,
  hint: "Higher is a wider lens with stronger depth.",
}

/**
 * Pinhole camera at the origin looking down +z (y down). A quad of the frame's size placed at
 * z = D exactly fills the view, so unrotated 3D blocks leave the picture where it was.
 */
function camera(c: EmitCtx): string {
  c.helper("rayQuad")
  c.helper("rot3")
  return `float asp = ${c.aspect()};
    float k = max(${c.in("perspective")}, 0.05);
    vec3 rd = vec3((uv - 0.5) * vec2(asp, 1.0) * k, 1.0);
    float D = 1.0 / k;`
}

/** What a card shows from behind. */
const BACK_FACE: Record<string, string> = {
  hide: "if (h.w < 0.5) return vec4(0.0);",
  dark: "if (h.w < 0.5) col.rgb *= 0.45;",
}

export const threeNodes: NodeDef[] = [
  {
    type: "rotate_3d",
    label: "3D rotate",
    category: "three",
    description: "Tilt and spin the picture in 3D space like a card, with real perspective.",
    inputs: [
      image,
      angle("rx", "Tilt (X)", 0),
      angle("ry", "Turn (Y)", 25),
      angle("rz", "Spin (Z)", 0),
      { id: "distance", label: "Push back", type: "float", default: 0.3, min: -0.5, max: 5 },
      { id: "offset", label: "Move", type: "vec2", default: [0, 0], min: -1, max: 1 },
      perspective,
    ],
    options: [
      {
        id: "back",
        label: "Back side",
        kind: "select",
        options: [
          { value: "show", label: "See through" },
          { value: "dark", label: "Darker" },
          { value: "hide", label: "Hidden" },
        ],
        default: "show",
      },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "facing", label: "Facing camera", type: "float" },
    ],
    emit: (c) => {
      const back = c.opt<string>("back")
      const hit = `${camera(c)}
    mat3 R = rot3(vec3(${c.in("rx")}, ${c.in("ry")}, ${c.in("rz")}));
    vec2 off = ${c.in("offset")};
    vec3 ctr = vec3(off.x * asp, off.y, D + ${c.in("distance")});
    vec4 h = rayQuad(rd, ctr, R * vec3(1.0, 0.0, 0.0), R * vec3(0.0, 1.0, 0.0), asp, 1.0);`
      return {
        image: `${hit}
    if (h.z < 0.0) return vec4(0.0);
    vec4 col = ${c.in("image", "h.xy")};
    ${BACK_FACE[back] ?? ""}
    return col;`,
        facing: `${hit}
    return h.z < 0.0 ? 0.0 : h.w;`,
      }
    },
  },
  {
    type: "sphere",
    label: "Sphere",
    category: "three",
    description: "Wrap the picture around a ball. Connect Time to Turn to make it spin.",
    inputs: [
      image,
      { id: "radius", label: "Size", type: "float", default: 0.42, min: 0.05, max: 1.5 },
      { id: "center", label: "Centre", type: "vec2", default: [0.5, 0.5], min: 0, max: 1, widget: "point" },
      angle("ry", "Turn", 0, -360, 360),
      angle("rx", "Tilt", 10),
      { id: "shading", label: "Shading", type: "float", default: 0.6, min: 0, max: 1 },
    ],
    outputs: [
      { id: "image", label: "Image", type: "color" },
      { id: "mask", label: "Ball mask", type: "float" },
    ],
    emit: (c) => {
      c.helper("rot3")
      const d = `float asp = ${c.aspect()};
    vec2 d = (uv - ${c.in("center")}) * vec2(asp, 1.0) / max(${c.in("radius")}, 0.0001);
    float r2 = dot(d, d);`
      return {
        image: `${d}
    if (r2 > 1.0) return vec4(0.0);
    vec3 n = vec3(d, -sqrt(1.0 - r2));
    vec3 s = rot3(vec3(${c.in("rx")}, ${c.in("ry")}, 0.0)) * n;
    float lon = atan(s.x, -s.z) / 6.2831853 + 0.5;
    float lat = asin(clamp(s.y, -1.0, 1.0)) / 3.14159265 + 0.5;
    vec4 col = ${c.in("image", "vec2(lon, lat)")};
    float light = clamp(dot(n, normalize(vec3(-0.4, -0.5, -0.75))), 0.0, 1.0);
    col.rgb *= mix(1.0, 0.25 + 0.85 * light, ${c.in("shading")});
    float edge = 1.0 - smoothstep(0.97, 1.0, r2);
    return vec4(col.rgb, col.a * edge);`,
        mask: `${d}
    return 1.0 - smoothstep(0.97, 1.0, r2);`,
      }
    },
  },
  {
    type: "card_flip",
    label: "Card flip",
    category: "three",
    description: "The old clip flips over like a card to show the new one on its back.",
    kinds: ["transition"],
    inputs: [
      fromIn,
      toIn,
      progressIn,
      { id: "lift", label: "Lift", type: "float", default: 0.4, min: 0, max: 2, hint: "How far the card moves away mid-flip." },
      perspective,
    ],
    options: [
      {
        id: "axis",
        label: "Flip",
        kind: "select",
        options: [
          { value: "y", label: "Sideways" },
          { value: "x", label: "Top over bottom" },
        ],
        default: "y",
      },
    ],
    outputs: out,
    emit: (c) => {
      const y = c.opt<string>("axis") !== "x"
      return {
        image: `${camera(c)}
    float p = clamp(${c.in("p")}, 0.0, 1.0);
    float a = p * 3.14159265;
    mat3 R = ${y ? "rotY(a)" : "rotX(-a)"};
    vec3 ctr = vec3(0.0, 0.0, D + ${c.in("lift")} * sin(p * 3.14159265));
    vec4 h = rayQuad(rd, ctr, R * vec3(1.0, 0.0, 0.0), R * vec3(0.0, 1.0, 0.0), asp, 1.0);
    if (h.z < 0.0) return vec4(0.0);
    if (h.w > 0.5) return ${c.in("from", "h.xy")};
    return ${c.in("to", y ? "vec2(1.0 - h.x, h.y)" : "vec2(h.x, 1.0 - h.y)")};`,
      }
    },
  },
  {
    type: "cube",
    label: "Cube",
    category: "three",
    description: "Both clips sit on the sides of a turning cube.",
    kinds: ["transition"],
    inputs: [
      fromIn,
      toIn,
      progressIn,
      { id: "unzoom", label: "Pull back", type: "float", default: 0.5, min: 0, max: 3 },
      perspective,
    ],
    options: [
      {
        id: "direction",
        label: "Turn",
        kind: "select",
        options: [
          { value: "left", label: "To the left" },
          { value: "right", label: "To the right" },
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" },
        ],
        default: "left",
      },
    ],
    outputs: out,
    emit: (c) => {
      const dir = c.opt<string>("direction")
      const horiz = dir === "left" || dir === "right"
      // Face B starts on the side the cube turns towards; R brings it to the front at p = 1.
      const setup: Record<string, string> = {
        left: "mat3 R = rotY(a); vec3 offB = vec3(asp * 0.5, 0.0, 0.0); vec3 axB = vec3(0.0, 0.0, 1.0); vec3 ayB = vec3(0.0, 1.0, 0.0);",
        right: "mat3 R = rotY(-a); vec3 offB = vec3(-asp * 0.5, 0.0, 0.0); vec3 axB = vec3(0.0, 0.0, -1.0); vec3 ayB = vec3(0.0, 1.0, 0.0);",
        up: "mat3 R = rotX(-a); vec3 offB = vec3(0.0, 0.5, 0.0); vec3 axB = vec3(1.0, 0.0, 0.0); vec3 ayB = vec3(0.0, 0.0, 1.0);",
        down: "mat3 R = rotX(a); vec3 offB = vec3(0.0, -0.5, 0.0); vec3 axB = vec3(1.0, 0.0, 0.0); vec3 ayB = vec3(0.0, 0.0, -1.0);",
      }
      return {
        image: `${camera(c)}
    float p = clamp(${c.in("p")}, 0.0, 1.0);
    float a = p * 1.5707963;
    float hd = ${horiz ? "asp * 0.5" : "0.5"};
    ${setup[dir] ?? setup.left}
    vec3 C = vec3(0.0, 0.0, D + hd + ${c.in("unzoom")} * sin(p * 3.14159265));
    vec4 ha = rayQuad(rd, C + R * vec3(0.0, 0.0, -hd), R * vec3(1.0, 0.0, 0.0), R * vec3(0.0, 1.0, 0.0), asp, 1.0);
    vec4 hb = rayQuad(rd, C + R * offB, R * axB, R * ayB, asp, 1.0);
    bool okA = ha.z > 0.0 && ha.w > 0.5;
    bool okB = hb.z > 0.0 && hb.w > 0.5;
    if (okA && (!okB || ha.z <= hb.z)) return ${c.in("from", "ha.xy")};
    if (okB) return ${c.in("to", "hb.xy")};
    return vec4(0.0);`,
      }
    },
  },
  {
    type: "doors",
    label: "Doors",
    category: "three",
    description: "The old clip splits down the middle and swings open like double doors.",
    kinds: ["transition"],
    inputs: [fromIn, toIn, progressIn, perspective],
    outputs: out,
    emit: (c) => ({
      image: `${camera(c)}
    float p = clamp(${c.in("p")}, 0.0, 1.0);
    float a = p * 1.5707963;
    mat3 RL = rotY(a);
    mat3 RR = rotY(-a);
    vec3 hingeL = vec3(-asp * 0.5, 0.0, D);
    vec3 hingeR = vec3(asp * 0.5, 0.0, D);
    vec4 hl = rayQuad(rd, hingeL + RL * vec3(asp * 0.25, 0.0, 0.0), RL * vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), asp * 0.5, 1.0);
    vec4 hr = rayQuad(rd, hingeR + RR * vec3(-asp * 0.25, 0.0, 0.0), RR * vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), asp * 0.5, 1.0);
    bool okL = hl.z > 0.0;
    bool okR = hr.z > 0.0;
    float shade = 1.0 - 0.45 * sin(a);
    if (okL && (!okR || hl.z <= hr.z)) {
        vec4 col = ${c.in("from", "vec2(hl.x * 0.5, hl.y)")};
        return vec4(col.rgb * shade, col.a);
    }
    if (okR) {
        vec4 col = ${c.in("from", "vec2(0.5 + hr.x * 0.5, hr.y)")};
        return vec4(col.rgb * shade, col.a);
    }
    return ${c.in("to", "(uv - 0.5) / (0.85 + 0.15 * p) + 0.5")};`,
    }),
  },
  {
    type: "page_curl",
    label: "Page curl",
    category: "three",
    description: "The old clip peels away like a turning page, revealing the new one underneath.",
    kinds: ["transition"],
    inputs: [
      fromIn,
      toIn,
      progressIn,
      angle("angle", "Direction", 200, 0, 360),
      { id: "radius", label: "Curl size", type: "float", default: 0.12, min: 0.02, max: 0.4 },
      { id: "shadow", label: "Shadow", type: "float", default: 0.5, min: 0, max: 1 },
    ],
    outputs: out,
    emit: (c) => ({
      image: `float asp = ${c.aspect()};
    vec2 q = uv * vec2(asp, 1.0);
    float ang = radians(${c.in("angle")});
    // The curl travels along -d; paper beyond the axis (x > A) is rolled around a cylinder.
    vec2 d = -vec2(cos(ang), sin(ang));
    float r = ${c.in("radius")};
    float x0 = dot(vec2(0.0), d);
    float x1 = dot(vec2(asp, 0.0), d);
    float x2 = dot(vec2(0.0, 1.0), d);
    float x3 = dot(vec2(asp, 1.0), d);
    float xmin = min(min(x0, x1), min(x2, x3));
    float xmax = max(max(x0, x1), max(x2, x3));
    float A = mix(xmax, xmin - 3.14159265 * r, clamp(${c.in("p")}, 0.0, 1.0));
    float x = dot(q, d);
    vec2 perp = q - d * x;
    vec2 pg;
    if (x <= A) {
        pg = (perp + d * (2.0 * A + 3.14159265 * r - x)) / vec2(asp, 1.0);
        if (pg.x >= 0.0 && pg.x <= 1.0 && pg.y >= 0.0 && pg.y <= 1.0) {
            return vec4(mix(${c.in("from", "pg")}.rgb, vec3(0.92), 0.75), 1.0);
        }
        return ${c.in("from")};
    }
    if (x <= A + r) {
        float th = asin(clamp((x - A) / r, 0.0, 1.0));
        pg = (perp + d * (A + r * (3.14159265 - th))) / vec2(asp, 1.0);
        if (pg.x >= 0.0 && pg.x <= 1.0 && pg.y >= 0.0 && pg.y <= 1.0) {
            return vec4(mix(${c.in("from", "pg")}.rgb, vec3(0.92), 0.75) * (0.75 + 0.25 * cos(th)), 1.0);
        }
        pg = (perp + d * (A + r * th)) / vec2(asp, 1.0);
        if (pg.x >= 0.0 && pg.x <= 1.0 && pg.y >= 0.0 && pg.y <= 1.0) {
            vec4 col = ${c.in("from", "pg")};
            return vec4(col.rgb * (1.0 - 0.35 * sin(th)), col.a);
        }
    }
    vec4 under = ${c.in("to")};
    float sh = (1.0 - smoothstep(0.0, r * 1.5, x - A - r)) * ${c.in("shadow")} * step(A + r, x) * 0.6;
    return vec4(under.rgb * (1.0 - sh), under.a);`,
    }),
  },
]
