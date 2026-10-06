import { color, float, type Starter, transition } from "../builder"

export const classicTransitions: Starter[] = [
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
]
