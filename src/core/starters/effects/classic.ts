import { color, effect, float, type Starter } from "../builder"

export const classicEffects: Starter[] = [
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
]
