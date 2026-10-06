import { float, type Starter, transition } from "../builder"

export const stylizedTransitions: Starter[] = [
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
