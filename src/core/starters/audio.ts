// Starting points for audio effects, built with the same rack operations the editor and the AI use.
import * as rack from "@/core/audio/rack"
import { isOpError, updateParam, type OpResult } from "@/core/edit/ops"
import type { ForgeDoc } from "@/core/doc/types"
import { emptyDoc } from "@/core/doc/util"
import type { Starter } from "./builder"

function must<T extends object>(r: OpResult<T>): { doc: ForgeDoc } & T {
  if (isOpError(r)) throw new Error(r.error)
  return r
}

class Board {
  doc: ForgeDoc
  constructor(name: string, category: string, description: string) {
    this.doc = emptyDoc("audio", name)
    this.doc.meta.category = category
    this.doc.meta.description = description
  }
  pedal(type: string, knobs: Record<string, number | boolean> = {}, slot?: rack.Slot): string {
    const r = must(rack.addPedal(this.doc, type, slot))
    this.doc = r.doc
    for (const [k, v] of Object.entries(knobs)) this.doc = rack.setValue(this.doc, { kind: "knob", item: r.id, knob: k }, v)
    return r.id
  }
  expose(path: rack.ValuePath, label: string) {
    const r = must(rack.exposeValue(this.doc, path))
    this.doc = must(updateParam(r.doc, r.param, { displayName: label })).doc
  }
}

function audio(name: string, category: string, description: string, build: (b: Board) => void): Starter {
  const b = new Board(name, category, description)
  build(b)
  return { name, description, doc: b.doc }
}

export const AUDIO_STARTERS: Starter[] = [
  audio("Blank audio effect", "space", "An empty board: the sound passes straight through. Build anything.", () => {}),

  audio("Radio voice", "transmission", "A voice squeezed through a small, overdriven speaker.", (b) => {
    const band = b.pedal("classic.bandlimit", { low_cut: 450, high_cut: 3200 })
    b.pedal("drive", { shape: 0, drive: 14, mix: 0.6, output: -8 })
    b.pedal("classic.compressor", { threshold: -24, ratio: 6 })
    b.expose({ kind: "knob", item: band, knob: "high_cut" }, "Tone")
  }),

  audio("Dreamy space", "space", "Soft, wide and far away: a darkened sound blended into reverb and echoes.", (b) => {
    b.pedal("filter", { mode: 0, cutoff: 5200, resonance: 0.7 })
    const s = must(rack.addSplit(b.doc, "parallel"))
    b.doc = must(rack.setCrossfade(s.doc, s.id, true)).doc
    b.doc = rack.setValue(b.doc, { kind: "blend", item: s.id }, 0.45)
    const wet = (rack.findItem(rack.rackOf(b.doc), s.id)!.item as { lanes: { id: string }[] }).lanes[1].id
    b.pedal("reverb", { size: 0.85, damping: 0.4, mix: 1 }, { lane: wet })
    b.pedal("delay", { time: 380, feedback: 0.45, mix: 0.4, pingpong: true }, { lane: wet })
    b.expose({ kind: "blend", item: s.id }, "Space")
  }),

  audio("Auto-wah", "texture", "A filter that opens as you play louder, for funky guitar and voice.", (b) => {
    const wah = b.pedal("ladder", { mode: 2, cutoff: 350, resonance: 0.7, drive: 1.5 })
    const env = must(rack.addModulator(b.doc, "envelope"))
    b.doc = env.doc
    b.doc = rack.setValue(b.doc, { kind: "modKnob", mod: env.id, knob: "gain" }, 4)
    const route = must(rack.addRoute(b.doc, env.id, wah, "cutoff", 0.55))
    b.doc = route.doc
    b.expose({ kind: "depth", route: route.id }, "Sweep")
  }),
]
