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
