import type { ForgeDoc, InputValue, Kind, ParamDef } from "@/doc/types"
import { emptyDoc, uid } from "@/doc/util"
import { createNode, outputType } from "@/nodes/registry"

export interface Starter {
  name: string
  description: string
  doc: ForgeDoc
}

class Graph {
  doc: ForgeDoc
  constructor(kind: Kind, name: string, category: string, description: string) {
    this.doc = emptyDoc(kind, name)
    this.doc.meta.category = category
    this.doc.meta.description = description
  }

  add(type: string, col: number, row: number, inputs: Record<string, InputValue> = {}, data: Record<string, unknown> = {}): string {
    const n = createNode(type, col * 280, row * 220)
    Object.assign(n.inputs, inputs)
    Object.assign(n.data, data)
    this.doc.nodes.push(n)
    return n.id
  }

  link(from: string, fromSocket: string, to: string, toSocket: string) {
    this.doc.edges.push({ id: uid("e"), from, fromSocket, to, toSocket })
  }

  param(p: ParamDef): { param: string } {
    this.doc.params.push(p)
    return { param: p.identifier }
  }

  output(col: number, row = 0): string {
    return this.add(outputType(this.doc.kind), col, row)
  }
}

/**
 * A Clip mask block: Drift's mask on the clip (e.g. Cut out subject), 1 on the person. `preview` is
 * the sample clip with a matte the editor previews on.
 */
function personMatte(g: Graph, col: number, row: number, preview = "dancer") {
  g.doc.preview.clip = preview
  return g.add("clip_mask", col, row)
}

function effect(name: string, category: string, description: string, build: (g: Graph) => void): Starter {
  const g = new Graph("effect", name, category, description)
  build(g)
  return { name, description, doc: g.doc }
}

function transition(name: string, category: string, description: string, build: (g: Graph) => void): Starter {
  const g = new Graph("transition", name, category, description)
  build(g)
  return { name, description, doc: g.doc }
}

const float = (identifier: string, displayName: string, def: number, min: number, max: number): ParamDef => ({
  identifier,
  displayName,
  type: "float",
  min,
  max,
  default: def,
})

const color = (identifier: string, displayName: string, def: string): ParamDef => ({
  identifier,
  displayName,
  type: "color",
  min: 0,
  max: 1,
  default: def,
})

export const STARTERS: Starter[] = [
  effect("Blank effect", "artistic", "Just the clip and an output. Build anything.", (g) => {
    const v = g.add("video", 0, 0)
    const o = g.output(2)
    g.link(v, "image", o, "image")
  }),

  effect("Glitch", "glitch", "Jumping slices and split colour, like a broken signal.", (g) => {
    const v = g.add("video", 0, 0)
    const gl = g.add("glitch_blocks", 1, 0, { amount: g.param(float("glitch", "Glitch", 0.5, 0, 1)) })
    const rgb = g.add("chromatic", 2, 0, { amount: g.param(float("split", "Colour split", 6, 0, 40)) })
    const sc = g.add("scanlines", 3, 0, { amount: 0.15 })
    const o = g.output(4)
    g.link(v, "image", gl, "image")
    g.link(gl, "image", rgb, "image")
    g.link(rgb, "image", sc, "image")
    g.link(sc, "image", o, "image")
  }),

  effect("VHS tape", "retro", "Wobble, bleed, grain and faded colour.", (g) => {
    const v = g.add("video", 0, 0)
    const vhs = g.add("vhs", 1, 0, { amount: g.param(float("wear", "Tape wear", 0.6, 0, 1)) })
    const sat = g.add("saturation", 2, 0, { amount: 0.75 })
    const gr = g.add("grain", 3, 0, { amount: 0.1 })
    const vig = g.add("vignette", 4, 0, { amount: 0.5 })
    const o = g.output(5)
    g.link(v, "image", vhs, "image")
    g.link(vhs, "image", sat, "image")
    g.link(sat, "image", gr, "image")
    g.link(gr, "image", vig, "image")
    g.link(vig, "image", o, "image")
  }),

  effect("Dreamy glow", "dreamy", "Highlights bloom into soft light.", (g) => {
    const v = g.add("video", 0, 0)
    const glow = g.add("glow", 1, 0, {
      threshold: g.param(float("threshold", "Threshold", 0.55, 0, 1)),
      intensity: g.param(float("intensity", "Intensity", 1.2, 0, 4)),
      radius: g.param(float("glowRadius", "Radius", 18, 1, 64)),
    })
    const tint = g.add("temperature", 2, 0, { amount: 0.15 })
    const o = g.output(3)
    g.link(v, "image", glow, "image")
    g.link(glow, "image", tint, "image")
    g.link(tint, "image", o, "image")
  }),

  effect("Zoom punch", "impact", "A rhythmic zoom kick with a colour split on every beat.", (g) => {
    const v = g.add("video", 0, 0)
    const lfo = g.add(
      "lfo",
      0,
      1,
      { rate: g.param(float("bps", "Beats per second", 2, 0.25, 8)), min: 1, max: 1.25 },
      { shape: "pulse" },
    )
    const lfo2 = g.add("lfo", 1, 1, { rate: { param: "bps" }, min: 0, max: 14 }, { shape: "pulse" })
    const z = g.add("zoom", 1, 0)
    const rgb = g.add("chromatic", 2, 0, {}, { mode: "radial" })
    const o = g.output(3)
    g.link(v, "image", z, "image")
    g.link(lfo, "value", z, "amount")
    g.link(z, "image", rgb, "image")
    g.link(lfo2, "value", rgb, "amount")
    g.link(rgb, "image", o, "image")
  }),

  effect("Duotone", "color", "Two-colour poster look.", (g) => {
    const v = g.add("video", 0, 0)
    const bc = g.add("brightness_contrast", 1, 0, { contrast: 1.2 })
    const d = g.add("gradient_map", 2, 0, {
      shadow: g.param(color("shadowColor", "Shadows", "#1b1446")),
      highlight: g.param(color("highlightColor", "Highlights", "#ffc107")),
    })
    const o = g.output(3)
    g.link(v, "image", bc, "image")
    g.link(bc, "image", d, "image")
    g.link(d, "image", o, "image")
  }),

  effect("Kaleidoscope", "artistic", "Slowly turning mirrored slices.", (g) => {
    const v = g.add("video", 0, 0)
    const t = g.add("time", 0, 1, { speed: g.param(float("spin", "Spin speed", 20, -120, 120)) })
    const k = g.add("kaleidoscope", 1, 0, { segments: g.param(float("slices", "Slices", 6, 2, 16)) })
    const o = g.output(2)
    g.link(v, "image", k, "image")
    g.link(t, "value", k, "rotation")
    g.link(k, "image", o, "image")
  }),

  effect("Tilt shift", "dreamy", "Sharp in a band across the middle, blurred above and below: the miniature look.", (g) => {
    const v = g.add("video", 0, 0)
    const lg = g.add("linear_gradient", 0, 1, { angle: 90 })
    const off = g.add("math", 1, 1, { b: g.param(float("focus", "Focus height", 0.5, 0, 1)) }, { op: "sub" })
    const ab = g.add("func", 2, 1, {}, { fn: "abs" })
    const rm = g.add("remap", 3, 1, { inMin: 0.08, inMax: 0.4, outMin: 0, outMax: g.param(float("blurAmount", "Blur", 18, 0, 48)) })
    const blur = g.add("blur", 4, 0)
    const sat = g.add("saturation", 5, 0, { amount: 1.3 })
    const o = g.output(6)
    g.link(lg, "t", off, "a")
    g.link(off, "value", ab, "x")
    g.link(ab, "value", rm, "x")
    g.link(v, "image", blur, "image")
    g.link(rm, "value", blur, "radius")
    g.link(blur, "image", sat, "image")
    g.link(sat, "image", o, "image")
  }),

  effect("Star filter", "dreamy", "Lights flare into star spikes.", (g) => {
    const v = g.add("video", 0, 0)
    const st = g.add("streaks", 1, 0, {
      points: g.param(float("spikes", "Spikes", 4, 1, 8)),
      length: g.param(float("spikeLength", "Length", 70, 10, 300)),
      threshold: 0.65,
    })
    const o = g.output(2)
    g.link(v, "image", st, "image")
    g.link(st, "image", o, "image")
  }),

  effect("Rainy day", "dreamy", "Cool tones and falling rain.", (g) => {
    const v = g.add("video", 0, 0)
    const cool = g.add("temperature", 1, 0, { amount: -0.35 })
    const rain = g.add("rain", 1, 1, { amount: g.param(float("rainAmount", "Rain", 0.5, 0, 1)) })
    const bl = g.add("blend", 2, 0, { opacity: 0.7 }, { mode: "screen" })
    const o = g.output(3)
    g.link(v, "image", cool, "image")
    g.link(cool, "image", bl, "base")
    g.link(rain, "mask", bl, "layer")
    g.link(bl, "image", o, "image")
  }),

  effect("Old film", "retro", "Black and white with scratches, dust and flicker.", (g) => {
    const v = g.add("video", 0, 0)
    const bw = g.add("saturation", 1, 0, { amount: 0 })
    const dmg = g.add("film_damage", 2, 0, { scratches: g.param(float("damage", "Damage", 0.6, 0, 1)) })
    const gr = g.add("grain", 3, 0, { amount: 0.14 })
    const vig = g.add("vignette", 4, 0, { amount: 0.7 })
    const o = g.output(5)
    g.link(v, "image", bw, "image")
    g.link(bw, "image", dmg, "image")
    g.link(dmg, "image", gr, "image")
    g.link(gr, "image", vig, "image")
    g.link(vig, "image", o, "image")
  }),

  effect("Green screen", "keying", "Cuts out a green background so the clip below shows through.", (g) => {
    const v = g.add("video", 0, 0)
    const k = g.add("chroma_key", 1, 0, { tolerance: g.param(float("tolerance", "Tolerance", 0.12, 0, 0.5)) })
    const o = g.output(2)
    g.link(v, "image", k, "image")
    g.link(k, "image", o, "image")
  }),

  effect("Complex power", "artistic", "The frame raised to a power as a complex number: a conformal fold that keeps every angle.", (g) => {
    const v = g.add("video", 0, 0)
    const z = g.add("complex_math", 1, 1, { n: g.param(float("power", "Power", 2, -4, 6)), zoom: g.param(float("zoom", "Zoom", 2, 0.5, 6)) }, { op: "pow" })
    const s = g.add("sample_at", 2, 0, {}, { edge: "mirror" })
    const o = g.output(3)
    g.link(v, "image", s, "image")
    g.link(z, "p", s, "p")
    g.link(s, "image", o, "image")
  }),

  effect("Möbius drift", "artistic", "A Möbius transform whose pole wanders, bending the frame into slowly flowing circles.", (g) => {
    const v = g.add("video", 0, 0)
    const amount = g.param(float("wander", "Wander", 0.5, 0, 0.9))
    const rate = g.param(float("drift", "Drift speed", 0.15, 0, 1))
    const lx = g.add("lfo", 0, 1, { rate, min: -1, max: 1 })
    const ly = g.add("lfo", 0, 2, { rate, min: -1, max: 1, phase: 0.25 })
    const w = g.add("combine_point", 1, 1)
    const ws = g.add("vector_math", 2, 1, { s: amount }, { op: "scale" })
    const z = g.add("complex_math", 3, 1, { zoom: g.param(float("zoom", "Zoom", 2, 0.5, 6)) }, { op: "mobius" })
    const s = g.add("sample_at", 4, 0, {}, { edge: "mirror" })
    const o = g.output(5)
    g.link(lx, "value", w, "x")
    g.link(ly, "value", w, "y")
    g.link(w, "p", ws, "a")
    g.link(ws, "p", z, "w")
    g.link(v, "image", s, "image")
    g.link(z, "p", s, "p")
    g.link(s, "image", o, "image")
  }),

  effect("Relief light", "artistic", "Brightness read as height and lit from the side, so the picture looks embossed in metal or clay.", (g) => {
    const v = g.add("video", 0, 0)
    const l = g.add("split_color", 1, 1)
    const d = g.add("derivative", 2, 1, { spacing: 1.5 })
    const light = g.add("vector_math", 2, 2, { a: [1, 0], s: g.param(float("lightAngle", "Light angle", 135, -180, 180)) }, { op: "rotate" })
    const dot = g.add("vector_measure", 3, 1)
    const k = g.add("math", 4, 1, { b: g.param(float("depth", "Depth", 0.004, 0, 0.02)) }, { op: "mul" })
    const h = g.add("math", 5, 1, { b: 0.5 }, { op: "add" })
    const bl = g.add("blend", 6, 0, { opacity: g.param(float("relief", "Strength", 0.9, 0, 1)) }, { mode: "overlay" })
    const o = g.output(7)
    g.link(v, "image", l, "color")
    g.link(l, "l", d, "x")
    g.link(d, "grad", dot, "a")
    g.link(light, "p", dot, "b")
    g.link(dot, "dot", k, "a")
    g.link(k, "value", h, "a")
    g.link(v, "image", bl, "base")
    g.link(h, "value", bl, "layer")
    g.link(bl, "image", o, "image")
  }),

  effect("Topographic", "artistic", "Contour lines traced through the brightness like a hiking map, the same width on steep and gentle slopes.", (g) => {
    const v = g.add("video", 0, 0)
    const blur = g.add("blur", 1, 1, { radius: 3 })
    const l = g.add("split_color", 2, 1)
    const n = g.add("math", 3, 1, { b: g.param(float("contours", "Lines", 12, 2, 40)) }, { op: "mul" })
    const fr = g.add("func", 4, 1, {}, { fn: "fract" })
    const c = g.add("math", 5, 1, { b: 0.5 }, { op: "sub" })
    const ab = g.add("func", 6, 1, {}, { fn: "abs" })
    const dist = g.add("math", 7, 1, { a: 0.5 }, { op: "sub" })
    const d = g.add("derivative", 4, 2)
    const res = g.add("resolution", 4, 3)
    const hgt = g.add("split_point", 5, 3)
    const perPx = g.add("math", 6, 2, {}, { op: "div" })
    const px = g.add("math", 8, 1, {}, { op: "div" })
    const mask = g.add("remap", 9, 1, { inMin: 0.4, inMax: g.param(float("lineWidth", "Line width (px)", 1.4, 0.6, 4)), outMin: 1, outMax: 0 })
    const ink = g.add("color_value", 9, 2, { color: g.param(color("lineColor", "Line colour", "#fff3d6")) })
    const mix = g.add("mix", 10, 0)
    const o = g.output(11)
    g.link(v, "image", blur, "image")
    g.link(blur, "image", l, "color")
    g.link(l, "l", n, "a")
    g.link(n, "value", fr, "x")
    g.link(fr, "value", c, "a")
    g.link(c, "value", ab, "x")
    g.link(ab, "value", dist, "b")
    g.link(n, "value", d, "x")
    g.link(res, "size", hgt, "p")
    g.link(d, "slope", perPx, "a")
    g.link(hgt, "y", perPx, "b")
    g.link(dist, "value", px, "a")
    g.link(perPx, "value", px, "b")
    g.link(px, "value", mask, "x")
    g.link(v, "image", mix, "a")
    g.link(ink, "color", mix, "b")
    g.link(mask, "value", mix, "amount")
    g.link(mix, "image", o, "image")
  }),

  effect("Curl flow", "dreamy", "The picture drifts along swirling currents that never bunch up or thin out.", (g) => {
    const v = g.add("video", 0, 0)
    const n = g.add("noise", 0, 1, { scale: g.param(float("swirlSize", "Swirl size", 3, 1, 10)), speed: g.param(float("flowSpeed", "Flow speed", 0.15, 0, 1)) }, { style: "smooth" })
    const d = g.add("derivative", 1, 1, { spacing: 2 })
    const perp = g.add("vector_math", 2, 1, {}, { op: "perp" })
    const k = g.add("vector_math", 3, 1, { s: g.param(float("flow", "Strength", 0.01, 0, 0.05)) }, { op: "scale" })
    const pos = g.add("uv", 3, 2)
    const p = g.add("vector_math", 4, 1, {}, { op: "add" })
    const s = g.add("sample_at", 5, 0, {}, { edge: "mirror" })
    const o = g.output(6)
    g.link(n, "value", d, "x")
    g.link(d, "grad", perp, "a")
    g.link(perp, "p", k, "a")
    g.link(pos, "uv", p, "a")
    g.link(k, "p", p, "b")
    g.link(v, "image", s, "image")
    g.link(p, "p", s, "p")
    g.link(s, "image", o, "image")
  }),

  effect("Pool caustics", "dreamy", "Rippling bright lines like sunlight through a swimming pool, focused where the water's surface bends light together.", (g) => {
    const v = g.add("video", 0, 0)
    const n = g.add("noise", 0, 1, { scale: g.param(float("waveSize", "Wave size", 5, 2, 12)), speed: g.param(float("waveSpeed", "Wave speed", 0.3, 0, 1.5)) }, { style: "smooth" })
    const d = g.add("derivative", 1, 1, { spacing: 2 })
    const k = g.add("vector_math", 2, 1, { s: g.param(float("refraction", "Refraction", 0.012, 0, 0.04)) }, { op: "scale" })
    const pos = g.add("uv", 2, 2)
    const p = g.add("vector_math", 3, 1, {}, { op: "add" })
    const j = g.add("jacobian", 4, 2, { spacing: 2 })
    const focus = g.add("math", 5, 2, { a: 1 }, { op: "div" })
    const ab = g.add("func", 6, 2, {}, { fn: "abs" })
    const bright = g.add("remap", 7, 2, { inMin: 1, inMax: 3, outMin: 0, outMax: 1 })
    const lit = g.add("tint", 8, 2, { color: g.param(color("lightColor", "Light colour", "#d8fbff")), amount: 1 })
    const s = g.add("sample_at", 4, 0)
    const bl = g.add("blend", 9, 0, { opacity: g.param(float("caustics", "Caustics", 0.6, 0, 1)) }, { mode: "screen" })
    const o = g.output(10)
    g.link(n, "value", d, "x")
    g.link(d, "grad", k, "a")
    g.link(pos, "uv", p, "a")
    g.link(k, "p", p, "b")
    g.link(p, "p", j, "p")
    g.link(j, "det", focus, "b")
    g.link(focus, "value", ab, "x")
    g.link(ab, "value", bright, "x")
    g.link(bright, "value", lit, "image")
    g.link(v, "image", s, "image")
    g.link(p, "p", s, "p")
    g.link(s, "image", bl, "base")
    g.link(lit, "image", bl, "layer")
    g.link(bl, "image", o, "image")
  }),

  effect("Funhouse shear", "funny", "The picture leans and stretches back and forth like a funhouse mirror.", (g) => {
    const v = g.add("video", 0, 0)
    const lean = g.param(float("lean", "Lean", 0.35, 0, 1))
    const rate = g.param(float("wobbleRate", "Speed", 0.5, 0, 3))
    const wave = g.add("lfo", 0, 1, { rate, min: -1, max: 1 })
    const b = g.add("math", 1, 1, { b: lean }, { op: "mul" })
    const m = g.add("math", 2, 1, { b: -0.5 }, { op: "mul" })
    const sq = g.add("lfo", 0, 2, { rate, min: 0.85, max: 1.15, phase: 0.25 })
    const w = g.add("matrix_warp", 3, 0, {}, { transparent: false })
    const o = g.output(4)
    g.link(wave, "value", b, "a")
    g.link(b, "value", m, "a")
    g.link(b, "value", w, "m01")
    g.link(m, "value", w, "m10")
    g.link(sq, "value", w, "m11")
    g.link(v, "image", w, "image")
    g.link(w, "image", o, "image")
  }),

  effect("Clone parade", "impact", "Two glowing copies of the person step out to either side, scaled from their feet with a linear transform.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 4, "stage-model")
    const sway = g.add("lfo", 0, 1, { rate: g.param(float("swayRate", "Sway speed", 0.5, 0, 3)), min: 0.8, max: 1 })
    const off = g.add("math", 1, 1, { a: g.param(float("spread", "Spread", 0.28, 0, 0.5)) }, { op: "mul" })
    const right = g.add("combine_point", 2, 1, { y: 0 })
    const left = g.add("vector_math", 3, 1, { s: -1 }, { op: "scale" })
    const size = g.param(float("cloneSize", "Clone size", 0.9, 0.5, 1.2))
    // Scaled about the feet so the clones stand on the same floor.
    const lt = (row: number) =>
      g.add("linear_transform", 4, row, { m00: size, m11: size, origin: [0.5, 1] }, { inverse: true })
    const pr = lt(2)
    const pl = lt(3)
    const imgR = g.add("sample_at", 5, 0, {}, { edge: "transparent" })
    const imgL = g.add("sample_at", 5, 1, {}, { edge: "transparent" })
    const mR = g.add("sample_at", 5, 2, {}, { edge: "transparent" })
    const mL = g.add("sample_at", 5, 3, {}, { edge: "transparent" })
    const tintAmt = g.param(float("cloneTint", "Clone tint", 0.45, 0, 1))
    const tR = g.add("tint", 6, 0, { color: g.param(color("rightColor", "Right clone", "#ff3d7f")), amount: tintAmt })
    const tL = g.add("tint", 6, 1, { color: g.param(color("leftColor", "Left clone", "#3dd2ff")), amount: tintAmt })
    const aR = g.add("split_color", 6, 2)
    const aL = g.add("split_color", 6, 3)
    const both = g.add("blend", 7, 3, {}, { mode: "add" })
    const halo = g.add("blur", 8, 3, { radius: g.param(float("haloSize", "Halo size", 18, 2, 48)) })
    const haloA = g.add("split_color", 9, 3)
    const haloCol = g.add("mix", 10, 3, { b: g.param(color("haloColor", "Halo", "#ff4f6d")) })
    const lit = g.add("blend", 8, 0, { opacity: g.param(float("halo", "Halo glow", 0.9, 0, 1)) }, { mode: "screen" })
    const withR = g.add("mix", 9, 0)
    const withL = g.add("mix", 10, 0)
    const front = g.add("mix", 11, 0)
    const o = g.output(12)
    g.link(sway, "value", off, "b")
    g.link(off, "value", right, "x")
    g.link(right, "p", left, "a")
    g.link(left, "p", pr, "offset")
    g.link(right, "p", pl, "offset")
    for (const [p, img, m] of [[pr, imgR, mR], [pl, imgL, mL]]) {
      g.link(p, "p", img, "p")
      g.link(p, "p", m, "p")
      g.link(v, "image", img, "image")
      g.link(mask, "mask", m, "image")
    }
    g.link(imgR, "image", tR, "image")
    g.link(imgL, "image", tL, "image")
    g.link(mR, "image", aR, "color")
    g.link(mL, "image", aL, "color")
    g.link(mR, "image", both, "base")
    g.link(mL, "image", both, "layer")
    g.link(both, "image", halo, "image")
    g.link(halo, "image", haloA, "color")
    g.link(haloA, "r", haloCol, "amount")
    g.link(v, "image", lit, "base")
    g.link(haloCol, "image", lit, "layer")
    g.link(lit, "image", withR, "a")
    g.link(tR, "image", withR, "b")
    g.link(aR, "r", withR, "amount")
    g.link(withR, "image", withL, "a")
    g.link(tL, "image", withL, "b")
    g.link(aL, "r", withL, "amount")
    g.link(withL, "image", front, "a")
    g.link(v, "image", front, "b")
    g.link(mask, "mask", front, "amount")
    g.link(front, "image", o, "image")
  }),

  effect("Neon outline", "impact", "A glowing line traces the person. The matte's gradient finds the edge, and its direction sets the colour, so the hue wheels around the body.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 2)
    const d = g.add("derivative", 1, 2, { spacing: 2 })
    const res = g.add("resolution", 1, 3)
    const hgt = g.add("split_point", 2, 3)
    const perPx = g.add("math", 3, 2, {}, { op: "div" })
    const edge = g.add("smoothstep", 4, 2, { low: 0.02, high: g.param(float("lineSoftness", "Softness", 0.18, 0.05, 0.5)) })
    const ang = g.add("vector_measure", 2, 4)
    const clock = g.add("time", 2, 5)
    const spin = g.add("math", 3, 5, { b: g.param(float("colorSpin", "Colour speed (°/s)", 90, -360, 360)) }, { op: "mul" })
    const hue = g.add("math", 4, 4, {}, { op: "add" })
    const ink = g.add("color_value", 4, 3, { color: g.param(color("neonColor", "Neon colour", "#00e5ff")) })
    const shift = g.add("hue_shift", 5, 3)
    const line = g.add("mix", 6, 2)
    const glow = g.add("glow", 7, 2, { threshold: 0, radius: g.param(float("neonGlow", "Glow size", 14, 2, 48)), intensity: g.param(float("neonIntensity", "Glow", 1.8, 0, 4)) })
    const dark = g.add("brightness_contrast", 1, 0, { brightness: g.param(float("backdrop", "Background", -0.35, -1, 0)) })
    const base = g.add("mix", 2, 0)
    const pulse = g.add("lfo", 7, 1, { rate: g.param(float("pulseRate", "Pulse speed", 2, 0, 8)), min: 0.55, max: 1 })
    const out = g.add("blend", 8, 0, {}, { mode: "add" })
    const o = g.output(9)
    g.link(mask, "mask", d, "x")
    g.link(res, "size", hgt, "p")
    g.link(d, "slope", perPx, "a")
    g.link(hgt, "y", perPx, "b")
    g.link(perPx, "value", edge, "x")
    g.link(d, "grad", ang, "a")
    g.link(clock, "value", spin, "a")
    g.link(ang, "angle", hue, "a")
    g.link(spin, "value", hue, "b")
    g.link(ink, "color", shift, "image")
    g.link(hue, "value", shift, "degrees")
    g.link(shift, "image", line, "b")
    g.link(edge, "value", line, "amount")
    g.link(line, "image", glow, "image")
    g.link(v, "image", dark, "image")
    g.link(dark, "image", base, "a")
    g.link(v, "image", base, "b")
    g.link(mask, "mask", base, "amount")
    g.link(base, "image", out, "base")
    g.link(glow, "image", out, "layer")
    g.link(pulse, "value", out, "opacity")
    g.link(out, "image", o, "image")
  }),

  effect("Sticker pop", "artistic", "The person peels off as a tilted, wobbling sticker with a white border and drop shadow over a soft background.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 5, "stage-model")
    const wob = g.add("lfo", 0, 1, { rate: g.param(float("wobbleSpeed", "Wobble speed", 0.8, 0, 4)), min: -1, max: 1 })
    const swing = g.add("math", 1, 1, { b: g.param(float("wobble", "Wobble (°)", 3, 0, 15)) }, { op: "mul" })
    const angle = g.add("math", 2, 1, { b: g.param(float("tilt", "Tilt (°)", -6, -30, 30)) }, { op: "add" })
    const rad = g.add("math", 3, 1, { b: Math.PI / 180 }, { op: "mul" })
    const cos = g.add("func", 4, 1, {}, { fn: "cos" })
    const sin = g.add("func", 4, 2, {}, { fn: "sin" })
    const size = g.param(float("stickerSize", "Size", 1.08, 0.7, 1.4))
    const a = g.add("math", 5, 1, { b: size }, { op: "mul" })
    const c = g.add("math", 5, 2, { b: size }, { op: "mul" })
    const b = g.add("func", 6, 2, {}, { fn: "neg" })
    // Rotation × scale matrix [[s·cos, −s·sin], [s·sin, s·cos]], inverted so the sticker turns forward.
    const pt = g.add("linear_transform", 7, 1, { origin: [0.5, 0.6] }, { inverse: true })
    const person = g.add("sample_at", 8, 0, {}, { edge: "transparent" })
    const pm = g.add("sample_at", 8, 3, {}, { edge: "transparent" })
    const pa = g.add("split_color", 9, 3)
    const grow = g.add("blur", 9, 4, { radius: g.param(float("border", "Border (px)", 10, 2, 30)) })
    const growA = g.add("split_color", 10, 4)
    const border = g.add("smoothstep", 11, 4, { low: 0.03, high: 0.1 })
    const pos = g.add("uv", 9, 5)
    const shift = g.add("vector_math", 10, 5, { b: [-0.012, -0.022] }, { op: "add" })
    const sh = g.add("sample_at", 11, 5)
    const shA = g.add("split_color", 12, 5)
    const shM = g.add("smoothstep", 13, 5, { low: 0.02, high: 0.5 })
    const shK = g.add("math", 14, 5, { b: g.param(float("shadow", "Shadow", 0.55, 0, 1)) }, { op: "mul" })
    const soft = g.add("blur", 1, 0, { radius: g.param(float("bgBlur", "Background blur", 14, 0, 48)) })
    const dim = g.add("brightness_contrast", 2, 0, { brightness: -0.15 })
    const shadowed = g.add("mix", 12, 0, { b: [0, 0, 0, 1] })
    const bordered = g.add("mix", 13, 0, { b: g.param(color("borderColor", "Border colour", "#ffffff")) })
    const final = g.add("mix", 14, 0)
    const o = g.output(15)
    g.link(wob, "value", swing, "a")
    g.link(swing, "value", angle, "a")
    g.link(angle, "value", rad, "a")
    g.link(rad, "value", cos, "x")
    g.link(rad, "value", sin, "x")
    g.link(cos, "value", a, "a")
    g.link(sin, "value", c, "a")
    g.link(c, "value", b, "x")
    g.link(a, "value", pt, "m00")
    g.link(b, "value", pt, "m01")
    g.link(c, "value", pt, "m10")
    g.link(a, "value", pt, "m11")
    g.link(v, "image", person, "image")
    g.link(pt, "p", person, "p")
    g.link(mask, "mask", pm, "image")
    g.link(pt, "p", pm, "p")
    g.link(pm, "image", pa, "color")
    g.link(pm, "image", grow, "image")
    g.link(grow, "image", growA, "color")
    g.link(growA, "r", border, "x")
    g.link(pos, "uv", shift, "a")
    g.link(grow, "image", sh, "image")
    g.link(shift, "p", sh, "p")
    g.link(sh, "image", shA, "color")
    g.link(shA, "r", shM, "x")
    g.link(shM, "value", shK, "a")
    g.link(v, "image", soft, "image")
    g.link(soft, "image", dim, "image")
    g.link(dim, "image", shadowed, "a")
    g.link(shK, "value", shadowed, "amount")
    g.link(shadowed, "image", bordered, "a")
    g.link(border, "value", bordered, "amount")
    g.link(bordered, "image", final, "a")
    g.link(person, "image", final, "b")
    g.link(pa, "r", final, "amount")
    g.link(final, "image", o, "image")
  }),

  effect("Focus punch", "impact", "On every beat the background zooms, smears and splits into RGB while the person stays sharp.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 3)
    const beat = g.add("lfo", 0, 1, { rate: g.param(float("bps", "Beats per second", 2, 0.25, 8)), min: 0, max: 1 }, { shape: "saw" })
    const decay = g.add("func", 1, 1, {}, { fn: "oneminus" })
    const pulse = g.add("math", 2, 1, { b: 3 }, { op: "pow" })
    const blurK = g.add("math", 3, 1, { b: g.param(float("punch", "Punch", 0.3, 0, 1)) }, { op: "mul" })
    const zoomK = g.add("remap", 3, 2, { outMin: 1, outMax: 1.08 })
    const splitK = g.add("math", 3, 3, { b: g.param(float("split", "Colour split (px)", 14, 0, 40)) }, { op: "mul" })
    const zoom = g.add("zoom", 4, 0)
    const zb = g.add("zoom_blur", 5, 0)
    const rgb = g.add("chromatic", 6, 0)
    const front = g.add("mix", 7, 0)
    const o = g.output(8)
    g.link(beat, "value", decay, "x")
    g.link(decay, "value", pulse, "a")
    g.link(pulse, "value", blurK, "a")
    g.link(pulse, "value", zoomK, "x")
    g.link(pulse, "value", splitK, "a")
    g.link(v, "image", zoom, "image")
    g.link(zoomK, "value", zoom, "amount")
    g.link(zoom, "image", zb, "image")
    g.link(blurK, "value", zb, "strength")
    g.link(zb, "image", rgb, "image")
    g.link(splitK, "value", rgb, "amount")
    g.link(rgb, "image", front, "a")
    g.link(v, "image", front, "b")
    g.link(mask, "mask", front, "amount")
    g.link(front, "image", o, "image")
  }),

  effect("Vortex backdrop", "dreamy", "The background twists into a whirlpool around the person. The Jacobian's curl lights up where it spins hardest.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 5)
    const pos = g.add("uv", 0, 1)
    const d = g.add("vector_math", 1, 1, { b: [0.5, 0.5] }, { op: "sub" })
    const r = g.add("vector_measure", 2, 2)
    const rr = g.add("math", 3, 2, { b: g.param(float("vortexSize", "Size", 0.45, 0.1, 1.5)) }, { op: "div" })
    const sq = g.add("func", 4, 2, {}, { fn: "square" })
    const neg = g.add("func", 5, 2, {}, { fn: "neg" })
    const fall = g.add("func", 6, 2, {}, { fn: "exp" })
    const swirl = g.add("lfo", 5, 3, { rate: g.param(float("vortexSpeed", "Speed", 0.2, 0, 2)), min: -1, max: 1 })
    const amt = g.add("math", 6, 3, { b: g.param(float("twist", "Twist (°)", 240, 0, 720)) }, { op: "mul" })
    const ang = g.add("math", 7, 2, {}, { op: "mul" })
    const rot = g.add("vector_math", 8, 1, {}, { op: "rotate" })
    const p = g.add("vector_math", 9, 1, { b: [0.5, 0.5] }, { op: "add" })
    const bg = g.add("sample_at", 10, 0, {}, { edge: "mirror" })
    const j = g.add("jacobian", 10, 2, { spacing: 2 })
    const curl = g.add("func", 11, 2, {}, { fn: "abs" })
    const glowAmt = g.add("remap", 12, 2, { inMin: 0, inMax: 4 })
    const lightCol = g.add("mix", 13, 2, { b: g.param(color("swirlColor", "Swirl light", "#8a6bff")) })
    const lit = g.add("blend", 11, 0, { opacity: g.param(float("swirlGlow", "Swirl glow", 0.6, 0, 1)) }, { mode: "screen" })
    const front = g.add("mix", 12, 0)
    const o = g.output(14)
    g.link(pos, "uv", d, "a")
    g.link(d, "p", r, "a")
    g.link(r, "length", rr, "a")
    g.link(rr, "value", sq, "x")
    g.link(sq, "value", neg, "x")
    g.link(neg, "value", fall, "x")
    g.link(swirl, "value", amt, "a")
    g.link(fall, "value", ang, "a")
    g.link(amt, "value", ang, "b")
    g.link(d, "p", rot, "a")
    g.link(ang, "value", rot, "s")
    g.link(rot, "p", p, "a")
    g.link(v, "image", bg, "image")
    g.link(p, "p", bg, "p")
    g.link(p, "p", j, "p")
    g.link(j, "curl", curl, "x")
    g.link(curl, "value", glowAmt, "x")
    g.link(glowAmt, "value", lightCol, "amount")
    g.link(bg, "image", lit, "base")
    g.link(lightCol, "image", lit, "layer")
    g.link(lit, "image", front, "a")
    g.link(v, "image", front, "b")
    g.link(mask, "mask", front, "amount")
    g.link(front, "image", o, "image")
  }),

  effect("Aura rings", "dreamy", "Rings of light ripple outward from the person, bending the background along the gradient of a blurred matte.", (g) => {
    const v = g.add("video", 0, 0)
    const mask = personMatte(g, 0, 5)
    const spread = g.add("blur", 1, 3, { radius: g.param(float("auraSize", "Aura size", 40, 8, 64)) })
    const field = g.add("split_color", 2, 3)
    const n = g.add("math", 3, 3, { b: g.param(float("rings", "Rings", 8, 2, 24)) }, { op: "mul" })
    const clock = g.add("time", 3, 4, { speed: g.param(float("ringSpeed", "Speed", 1.2, 0, 5)) })
    const phase = g.add("math", 4, 3, {}, { op: "add" })
    const fr = g.add("func", 5, 3, {}, { fn: "fract" })
    const centred = g.add("math", 6, 3, { b: 0.5 }, { op: "sub" })
    const ab = g.add("func", 7, 3, {}, { fn: "abs" })
    const ring = g.add("smoothstep", 8, 3, { low: 0.36, high: 0.5 })
    const near = g.add("smoothstep", 4, 4, { low: 0.02, high: 0.3 })
    const outside = g.add("func", 4, 5, {}, { fn: "oneminus" })
    const fade = g.add("math", 5, 4, {}, { op: "mul" })
    const rm = g.add("math", 9, 3, {}, { op: "mul" })
    const d = g.add("derivative", 3, 2, { spacing: 2 })
    const k = g.add("math", 10, 2, { b: g.param(float("refraction", "Refraction", 0.0025, 0, 0.01)) }, { op: "mul" })
    const push = g.add("vector_math", 11, 1, {}, { op: "scale" })
    const pos = g.add("uv", 11, 2)
    const p = g.add("vector_math", 12, 1, {}, { op: "add" })
    const bg = g.add("sample_at", 13, 0)
    const light = g.add("mix", 12, 3, { b: g.param(color("auraColor", "Aura colour", "#ffb347")) })
    const lit = g.add("blend", 14, 0, { opacity: g.param(float("auraGlow", "Glow", 0.8, 0, 1)) }, { mode: "screen" })
    const front = g.add("mix", 15, 0)
    const o = g.output(16)
    g.link(mask, "mask", spread, "image")
    g.link(spread, "image", field, "color")
    g.link(field, "r", n, "a")
    g.link(n, "value", phase, "a")
    g.link(clock, "value", phase, "b")
    g.link(phase, "value", fr, "x")
    g.link(fr, "value", centred, "a")
    g.link(centred, "value", ab, "x")
    g.link(ab, "value", ring, "x")
    g.link(field, "r", near, "x")
    g.link(mask, "mask", outside, "x")
    g.link(near, "value", fade, "a")
    g.link(outside, "value", fade, "b")
    g.link(ring, "value", rm, "a")
    g.link(fade, "value", rm, "b")
    g.link(field, "r", d, "x")
    g.link(rm, "value", k, "a")
    g.link(d, "grad", push, "a")
    g.link(k, "value", push, "s")
    g.link(pos, "uv", p, "a")
    g.link(push, "p", p, "b")
    g.link(v, "image", bg, "image")
    g.link(p, "p", bg, "p")
    g.link(rm, "value", light, "amount")
    g.link(bg, "image", lit, "base")
    g.link(light, "image", lit, "layer")
    g.link(lit, "image", front, "a")
    g.link(v, "image", front, "b")
    g.link(mask, "mask", front, "amount")
    g.link(front, "image", o, "image")
  }),

  transition("Blank transition", "basic", "A plain crossfade to start from.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const m = g.add("mix", 1, 0)
    const o = g.output(2)
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(p, "value", m, "amount")
    g.link(m, "image", o, "image")
  }),

  transition("Glowing wipe", "basic", "A soft edge sweeps across with a line of light.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const w = g.add("wipe_mask", 0, 2, {
      angle: g.param(float("direction", "Direction", 0, 0, 360)),
      softness: g.param(float("softness", "Softness", 0.08, 0, 0.5)),
    })
    const m = g.add("mix", 1, 0)
    const glow = g.add("edge_glow", 1, 2, { color: g.param(color("glowColor", "Glow colour", "#ffc107")) })
    const bl = g.add("blend", 2, 0, {}, { mode: "add" })
    const o = g.output(3)
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(w, "mask", m, "amount")
    g.link(w, "mask", glow, "mask")
    g.link(m, "image", bl, "base")
    g.link(glow, "image", bl, "layer")
    g.link(bl, "image", o, "image")
  }),

  transition("Iris", "geometric", "A circle opens from the middle.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const i = g.add("iris_mask", 0, 2, { softness: g.param(float("softness", "Softness", 0.03, 0, 0.5)) })
    const m = g.add("mix", 1, 0)
    const o = g.output(2)
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(i, "mask", m, "amount")
    g.link(m, "image", o, "image")
  }),

  transition("Burn away", "liquid", "The old clip burns away in fiery patches.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const d = g.add("dissolve_mask", 0, 2, {
      scale: g.param(float("patchSize", "Patch size", 5, 1, 20)),
      softness: 0.04,
    })
    const m = g.add("mix", 1, 0)
    const glow = g.add("edge_glow", 1, 2, {
      color: g.param(color("fireColor", "Fire colour", "#ff6a00")),
      intensity: 2.5,
      sharpness: 3,
    })
    const bl = g.add("blend", 2, 0, {}, { mode: "add" })
    const o = g.output(3)
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(d, "mask", m, "amount")
    g.link(d, "mask", glow, "mask")
    g.link(m, "image", bl, "base")
    g.link(glow, "image", bl, "layer")
    g.link(bl, "image", o, "image")
  }),

  transition("Liquid melt", "liquid", "Both clips ripple like liquid as they swap.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const n = g.add("noise", 0, 3, { scale: 4 })
    const strength = g.param(float("melt", "Melt", 0.25, 0, 1))
    const out1 = g.add("math", 1, 2, { b: strength }, { op: "mul" })
    const inv = g.add("func", 1, 3, {}, { fn: "oneminus" })
    const out2 = g.add("math", 2, 3, { b: strength }, { op: "mul" })
    const da = g.add("displace", 2, 0, {}, { edge: "mirror" })
    const db = g.add("displace", 2, 1, {}, { edge: "mirror" })
    const e = g.add("ease", 2, 2)
    const m = g.add("mix", 3, 0)
    const o = g.output(4)
    g.link(p, "value", out1, "a")
    g.link(p, "value", inv, "x")
    g.link(inv, "value", out2, "a")
    g.link(a, "image", da, "image")
    g.link(n, "value", da, "map")
    g.link(out1, "value", da, "strength")
    g.link(b, "image", db, "image")
    g.link(n, "value", db, "map")
    g.link(out2, "value", db, "strength")
    g.link(da, "image", m, "a")
    g.link(db, "image", m, "b")
    g.link(e, "value", m, "amount")
    g.link(m, "image", o, "image")
  }),

  transition("Push", "geometric", "The new clip pushes the old one out of frame.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const e = g.add("ease", 1, 2)
    const push = g.add("push", 2, 0)
    const o = g.output(3)
    g.link(a, "image", push, "from")
    g.link(b, "image", push, "to")
    g.link(p, "value", e, "t")
    g.link(e, "value", push, "p")
    g.link(push, "image", o, "image")
  }),
  transition("Random squares", "geometric", "The new clip appears tile by tile in random order.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const grid = g.add("grid_cells", 0, 2, { count: [12, 7] })
    const rv = g.add("reveal", 1, 2, { softness: 0.02 })
    const m = g.add("mix", 2, 0)
    const o = g.output(3)
    g.link(grid, "random", rv, "pattern")
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(rv, "mask", m, "amount")
    g.link(m, "image", o, "image")
  }),

  transition("Clock wipe", "geometric", "A hand sweeps round like a clock.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const c = g.add("clock_wipe", 0, 2)
    const m = g.add("mix", 1, 0)
    const o = g.output(2)
    g.link(a, "image", m, "a")
    g.link(b, "image", m, "b")
    g.link(c, "mask", m, "amount")
    g.link(m, "image", o, "image")
  }),

  transition("Dip to black", "basic", "Fade out to black, then into the new clip.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const d = g.add("dip", 1, 0, { color: g.param(color("dipColor", "Colour", "#000000")) })
    const o = g.output(2)
    g.link(a, "image", d, "from")
    g.link(b, "image", d, "to")
    g.link(d, "image", o, "image")
  }),

  transition("Silhouette portal", "geometric", "The person's outline becomes a window into the next clip and grows exponentially until it fills the frame, traced by a neon edge.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const mask = personMatte(g, 0, 4)
    const p = g.add("progress", 0, 2)
    const sq = g.add("func", 1, 2, {}, { fn: "square" })
    const k = g.add("math", 2, 2, { b: g.param(float("growth", "Growth", 3.5, 1, 6)) }, { op: "mul" })
    const s = g.add("func", 3, 2, {}, { fn: "exp" })
    const at = g.param({ identifier: "portalCentre", displayName: "Grow from", type: "point", min: 0, max: 1, default: [0.5, 0.4] })
    // The silhouette scaled by s about a point on the person: sample the matte at the inverse.
    const lt = g.add("linear_transform", 4, 2, { origin: at }, { inverse: true })
    const pm = g.add("sample_at", 5, 3, {}, { edge: "transparent" })
    const inside = g.add("split_color", 6, 3)
    const d = g.add("derivative", 7, 3, { spacing: 2 })
    const res = g.add("resolution", 7, 4)
    const hgt = g.add("split_point", 8, 4)
    const perPx = g.add("math", 8, 3, {}, { op: "div" })
    const edge = g.add("smoothstep", 9, 3, { low: 0.02, high: 0.2 })
    const line = g.add("mix", 10, 3, { b: g.param(color("edgeColor", "Edge colour", "#4dfcff")) })
    const glow = g.add("glow", 11, 3, { threshold: 0, radius: 12, intensity: g.param(float("edgeGlow", "Edge glow", 1.6, 0, 4)) })
    const finish = g.add("smoothstep", 6, 1, { low: 0.85, high: 1 })
    const reveal = g.add("math", 7, 1, {}, { op: "max" })
    const mix = g.add("mix", 8, 0)
    const fadeEdge = g.add("func", 9, 1, {}, { fn: "oneminus" })
    const out = g.add("blend", 12, 0, {}, { mode: "add" })
    const o = g.output(13)
    g.link(p, "value", sq, "x")
    g.link(sq, "value", k, "a")
    g.link(k, "value", s, "x")
    g.link(s, "value", lt, "m00")
    g.link(s, "value", lt, "m11")
    g.link(mask, "mask", pm, "image")
    g.link(lt, "p", pm, "p")
    g.link(pm, "image", inside, "color")
    g.link(inside, "r", d, "x")
    g.link(res, "size", hgt, "p")
    g.link(d, "slope", perPx, "a")
    g.link(hgt, "y", perPx, "b")
    g.link(perPx, "value", edge, "x")
    g.link(edge, "value", line, "amount")
    g.link(line, "image", glow, "image")
    g.link(p, "value", finish, "x")
    g.link(inside, "r", reveal, "a")
    g.link(finish, "value", reveal, "b")
    g.link(a, "image", mix, "a")
    g.link(b, "image", mix, "b")
    g.link(reveal, "value", mix, "amount")
    g.link(finish, "value", fadeEdge, "x")
    g.link(mix, "image", out, "base")
    g.link(glow, "glow", out, "layer")
    g.link(fadeEdge, "value", out, "opacity")
    g.link(out, "image", o, "image")
  }),

  transition("Subject pop-through", "cinematic", "The person holds still in front while the world behind them punches through a zoom blur into the next clip, then they dissolve away.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const mask = personMatte(g, 0, 4)
    const p = g.add("progress", 0, 2)
    const fade = g.add("ease", 1, 1, {}, { curve: "expo" })
    const peak = g.add("ease", 1, 2, {}, { curve: "peaksmooth" })
    const blurK = g.add("math", 2, 2, { b: g.param(float("punch", "Punch", 0.45, 0, 1)) }, { op: "mul" })
    const splitK = g.add("math", 2, 3, { b: g.param(float("split", "Colour split (px)", 18, 0, 40)) }, { op: "mul" })
    const bg = g.add("mix", 2, 0)
    const zb = g.add("zoom_blur", 3, 0)
    const rgb = g.add("chromatic", 4, 0)
    const leave = g.add("smoothstep", 2, 4, { low: g.param(float("holdUntil", "Person leaves at", 0.7, 0.3, 0.95)), high: 1 })
    const keep = g.add("func", 3, 4, {}, { fn: "oneminus" })
    const m = g.add("math", 4, 4, {}, { op: "mul" })
    const front = g.add("mix", 5, 0)
    const o = g.output(6)
    g.link(p, "value", fade, "t")
    g.link(p, "value", peak, "t")
    g.link(peak, "value", blurK, "a")
    g.link(peak, "value", splitK, "a")
    g.link(a, "image", bg, "a")
    g.link(b, "image", bg, "b")
    g.link(fade, "value", bg, "amount")
    g.link(bg, "image", zb, "image")
    g.link(blurK, "value", zb, "strength")
    g.link(zb, "image", rgb, "image")
    g.link(splitK, "value", rgb, "amount")
    g.link(p, "value", leave, "x")
    g.link(leave, "value", keep, "x")
    g.link(mask, "mask", m, "a")
    g.link(keep, "value", m, "b")
    g.link(rgb, "image", front, "a")
    g.link(a, "image", front, "b")
    g.link(m, "value", front, "amount")
    g.link(front, "image", o, "image")
  }),

  transition("Sticker fling", "stylized", "The person peels off as a white-bordered sticker and spins away off the top of the frame, uncovering the next clip.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const mask = personMatte(g, 0, 6, "stage-model")
    const p = g.add("progress", 0, 2)
    const lift = g.add("ease", 1, 2, {}, { curve: "in" })
    const angle = g.add("math", 2, 2, { b: g.param(float("spin", "Spin (°)", 35, -180, 180)) }, { op: "mul" })
    const rad = g.add("math", 3, 2, { b: Math.PI / 180 }, { op: "mul" })
    const cos = g.add("func", 4, 2, {}, { fn: "cos" })
    const sin = g.add("func", 4, 3, {}, { fn: "sin" })
    const grow = g.add("remap", 2, 3, { outMin: 1, outMax: g.param(float("flingSize", "End size", 1.3, 0.5, 2)) })
    const m00 = g.add("math", 5, 2, {}, { op: "mul" })
    const m10 = g.add("math", 5, 3, {}, { op: "mul" })
    const m01 = g.add("func", 6, 3, {}, { fn: "neg" })
    const dx = g.add("math", 2, 4, { b: -0.25 }, { op: "mul" })
    const dy = g.add("math", 2, 5, { b: 1.4 }, { op: "mul" })
    const off = g.add("combine_point", 3, 4)
    // Rotate × scale, then move up; inverted so each pixel reads where the sticker came from.
    const pt = g.add("linear_transform", 7, 2, { origin: [0.5, 0.6] }, { inverse: true })
    const person = g.add("sample_at", 8, 0, {}, { edge: "transparent" })
    const pm = g.add("sample_at", 8, 4, {}, { edge: "transparent" })
    const pa = g.add("split_color", 9, 4)
    const thick = g.add("blur", 9, 5, { radius: g.param(float("border", "Border (px)", 10, 2, 30)) })
    const thickA = g.add("split_color", 10, 5)
    const border = g.add("smoothstep", 11, 5, { low: 0.03, high: 0.1 })
    const peel = g.add("smoothstep", 10, 6, { low: 0, high: 0.08 })
    const borderK = g.add("math", 12, 5, {}, { op: "mul" })
    const fade = g.add("smoothstep", 1, 1, { low: 0, high: 0.5 })
    const bg = g.add("mix", 2, 0)
    const bordered = g.add("mix", 10, 0, { b: g.param(color("borderColor", "Border colour", "#ffffff")) })
    const final = g.add("mix", 11, 0)
    const o = g.output(12)
    g.link(p, "value", lift, "t")
    g.link(lift, "value", angle, "a")
    g.link(angle, "value", rad, "a")
    g.link(rad, "value", cos, "x")
    g.link(rad, "value", sin, "x")
    g.link(lift, "value", grow, "x")
    g.link(cos, "value", m00, "a")
    g.link(grow, "value", m00, "b")
    g.link(sin, "value", m10, "a")
    g.link(grow, "value", m10, "b")
    g.link(m10, "value", m01, "x")
    g.link(m00, "value", pt, "m00")
    g.link(m01, "value", pt, "m01")
    g.link(m10, "value", pt, "m10")
    g.link(m00, "value", pt, "m11")
    g.link(lift, "value", dx, "a")
    g.link(lift, "value", dy, "a")
    g.link(dx, "value", off, "x")
    g.link(dy, "value", off, "y")
    g.link(off, "p", pt, "offset")
    g.link(a, "image", person, "image")
    g.link(pt, "p", person, "p")
    g.link(mask, "mask", pm, "image")
    g.link(pt, "p", pm, "p")
    g.link(pm, "image", pa, "color")
    g.link(pm, "image", thick, "image")
    g.link(thick, "image", thickA, "color")
    g.link(thickA, "r", border, "x")
    g.link(p, "value", peel, "x")
    g.link(border, "value", borderK, "a")
    g.link(peel, "value", borderK, "b")
    g.link(p, "value", fade, "x")
    g.link(a, "image", bg, "a")
    g.link(b, "image", bg, "b")
    g.link(fade, "value", bg, "amount")
    g.link(bg, "image", bordered, "a")
    g.link(borderK, "value", bordered, "amount")
    g.link(bordered, "image", final, "a")
    g.link(person, "image", final, "b")
    g.link(pa, "r", final, "amount")
    g.link(final, "image", o, "image")
  }),

  transition("Conformal twist", "distortion", "Both clips fold through a complex power that peaks mid-way, then unfold as the new clip.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const peak = g.add("ease", 1, 2, {}, { curve: "peaksmooth" })
    const n = g.add("math", 2, 2, { b: g.param(float("twist", "Twist", 2, 0.5, 5)) }, { op: "mul" })
    const n1 = g.add("math", 3, 2, { b: 1 }, { op: "add" })
    const z = g.add("complex_math", 4, 2, { zoom: 2 }, { op: "pow" })
    const sa = g.add("sample_at", 5, 0, {}, { edge: "mirror" })
    const sb = g.add("sample_at", 5, 1, {}, { edge: "mirror" })
    const fade = g.add("ease", 1, 3)
    const mix = g.add("mix", 6, 0)
    const o = g.output(7)
    g.link(p, "value", peak, "t")
    g.link(peak, "value", n, "a")
    g.link(n, "value", n1, "a")
    g.link(n1, "value", z, "n")
    g.link(a, "image", sa, "image")
    g.link(b, "image", sb, "image")
    g.link(z, "p", sa, "p")
    g.link(z, "p", sb, "p")
    g.link(p, "value", fade, "t")
    g.link(sa, "image", mix, "a")
    g.link(sb, "image", mix, "b")
    g.link(fade, "value", mix, "amount")
    g.link(mix, "image", o, "image")
  }),

  transition("Cube", "stylized", "Both clips on a turning cube.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const e = g.add("ease", 1, 2)
    const c = g.add("cube", 2, 0)
    const o = g.output(3)
    g.link(p, "value", e, "t")
    g.link(a, "image", c, "from")
    g.link(b, "image", c, "to")
    g.link(e, "value", c, "p")
    g.link(c, "image", o, "image")
  }),

  transition("Card flip", "stylized", "The old clip flips over to reveal the new one.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const e = g.add("ease", 1, 2)
    const c = g.add("card_flip", 2, 0)
    const o = g.output(3)
    g.link(p, "value", e, "t")
    g.link(a, "image", c, "from")
    g.link(b, "image", c, "to")
    g.link(e, "value", c, "p")
    g.link(c, "image", o, "image")
  }),

  transition("Page curl", "stylized", "The old clip peels away like a page.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const c = g.add("page_curl", 1, 0)
    const o = g.output(2)
    g.link(a, "image", c, "from")
    g.link(b, "image", c, "to")
    g.link(c, "image", o, "image")
  }),

  transition("Doors", "stylized", "The old clip opens like double doors.", (g) => {
    const a = g.add("from", 0, 0)
    const b = g.add("to", 0, 1)
    const p = g.add("progress", 0, 2)
    const e = g.add("ease", 1, 2, {}, { curve: "in" })
    const c = g.add("doors", 2, 0)
    const o = g.output(3)
    g.link(p, "value", e, "t")
    g.link(a, "image", c, "from")
    g.link(b, "image", c, "to")
    g.link(e, "value", c, "p")
    g.link(c, "image", o, "image")
  }),
]
