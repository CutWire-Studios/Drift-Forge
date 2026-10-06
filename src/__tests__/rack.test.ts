import { readFileSync } from "node:fs"
import { beforeAll, describe, expect, it } from "vitest"
import { legacyAudioDoc } from "@/core/audio/processors"
import * as rack from "@/core/audio/rack"
import { loadDriftAudio, WasmGraph, type DriftAudioModule } from "@/services/audio-preview/wasm/graph"
import { audioPackageJson, minAppVersion } from "@/core/compiler/manifest"
import { compile } from "@/core/compiler/compile"
import { isOpError, removeParam, updateParam, type OpResult } from "@/core/edit/ops"
import { isSplit, type ForgeDoc, type SplitBlock } from "@/core/doc/types"
import { emptyDoc } from "@/core/doc/util"
import { parseForgeDoc } from "@/core/export/link"

function ok<T extends object>(r: OpResult<T>): { doc: ForgeDoc } & T {
  if (isOpError(r)) throw new Error(r.error)
  return r
}

/** Filter → split(reverb | blend dry) → band split with a classic compressor, an LFO on the cutoff. */
function bigBoard(): ForgeDoc {
  let d = emptyDoc("audio")
  const f = ok(rack.addPedal(d, "filter"))
  d = f.doc
  const s = ok(rack.addSplit(d, "parallel"))
  d = s.doc
  const split = rack.findItem(rack.rackOf(d), s.id)!.item as SplitBlock
  d = ok(rack.addPedal(d, "reverb", { lane: split.lanes[0].id })).doc
  d = ok(rack.setCrossfade(d, s.id, true)).doc
  d = ok(rack.exposeValue(d, { kind: "blend", item: s.id })).doc
  const b = ok(rack.addSplit(d, "bands", 3))
  d = b.doc
  const bands = rack.findItem(rack.rackOf(d), b.id)!.item as SplitBlock
  d = ok(rack.addPedal(d, "classic.compressor", { lane: bands.lanes[0].id })).doc
  d = ok(rack.addPedal(d, "drive", { lane: bands.lanes[2].id })).doc
  const m = ok(rack.addModulator(d, "lfo"))
  d = ok(rack.addRoute(m.doc, m.id, f.id, "cutoff", 0.4)).doc
  d = ok(rack.exposeValue(d, { kind: "knob", item: f.id, knob: "cutoff" })).doc
  const e = ok(rack.addModulator(d, "envelope"))
  return rack.setModulatorSource(e.doc, e.id, f.id)
}

describe("pedalboard documents", () => {
  let M: DriftAudioModule
  beforeAll(async () => {
    M = await loadDriftAudio(await WebAssembly.compile(readFileSync(new URL("../../public/audio/drift-audio.wasm", import.meta.url))))
  })

  const loads = (doc: ForgeDoc) => {
    const graph = WasmGraph.create(M, JSON.stringify(audioPackageJson(doc)), 48000)
    graph.reset(0)
    const buf = new Float32Array(4800).map((_, i) => Math.sin(i / 7) * 0.5)
    graph.process(buf)
    graph.destroy()
    return buf
  }

  it("exports boards Drift's own parser accepts and that make sound", () => {
    const doc = bigBoard()
    expect(rack.validateRack(doc)).toEqual([])
    const out = loads(doc)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(out.some((v) => Math.abs(v) > 0.01)).toBe(true)
    const json = audioPackageJson(doc)
    expect(json.processor).toBe("graph")
    expect(json.nextFeatures).toEqual(["audio:graph", "audio:modulation"])
    expect(minAppVersion(doc, compile(doc, { mode: "export" }))).toBe("0.8.0")
  })

  it("opens schema-1 documents as one classic pedal and exports them unchanged", () => {
    const legacy = JSON.stringify({
      forge: 1,
      kind: "audio",
      meta: { id: "forge_trem_ab12", displayName: "Trem", category: "space", description: "", author: "", version: "1.0.0" },
      params: [
        { identifier: "rate", displayName: "Rate", type: "float", min: 0.1, max: 20, default: 5 },
        { identifier: "depth", displayName: "Depth", type: "float", min: 0, max: 1, default: 0.7 },
      ],
      nodes: [],
      edges: [],
      audio: { processor: "tremolo" },
      preview: { thumbTime: 0.5 },
    })
    const doc = parseForgeDoc(legacy)
    expect(doc.forge).toBe(2)
    expect(doc.audio!.rack.chain).toEqual([{ id: "p1", type: "classic.tremolo", knobs: { rate: { param: "rate" }, depth: { param: "depth" } } }])
    expect(rack.legacyProcessorFor(doc)).toBe("tremolo")
    expect(audioPackageJson(doc)).toMatchObject({ processor: "tremolo", prerollMs: 0, icon: "audio-waveform" })
    expect(audioPackageJson(doc)).not.toHaveProperty("graph")
    expect(minAppVersion(doc, compile(doc, { mode: "export" }))).toBe("0.7.1")
    loads(doc)
  })

  it("stops being legacy once the board is changed", () => {
    const doc = ok(rack.addPedal(legacyAudioDoc("echo"), "gain")).doc
    expect(rack.legacyProcessorFor(doc)).toBeNull()
    expect(audioPackageJson(doc).processor).toBe("graph")
    loads(doc)
  })

  it("keeps slider bindings in step with renames and deletes", () => {
    let doc = bigBoard()
    const cutoff = doc.params.find((p) => p.displayName === "Cutoff")!
    doc = ok(updateParam(doc, cutoff.identifier, { identifier: "tone" })).doc
    const filter = rack.rackOf(doc).chain[0]
    expect(!isSplit(filter) && filter.knobs.cutoff).toEqual({ param: "tone" })
    doc = removeParam(doc, "tone")
    const after = rack.rackOf(doc).chain[0]
    expect(!isSplit(after) && typeof after.knobs.cutoff).toBe("number")
    expect(rack.validateRack(doc)).toEqual([])
  })

  it("exposes and releases a control, dropping the slider when nothing reads it", () => {
    let doc = ok(rack.addPedal(emptyDoc("audio"), "delay")).doc
    const id = rack.rackOf(doc).chain[0].id
    const r = ok(rack.exposeValue(doc, { kind: "knob", item: id, knob: "pingpong" }))
    expect(r.doc.params.find((p) => p.identifier === r.param)).toMatchObject({ type: "bool", default: false })
    doc = rack.unexposeValue(r.doc, { kind: "knob", item: id, knob: "pingpong" })
    expect(doc.params).toEqual([])
    expect(rack.getValue(rack.rackOf(doc), { kind: "knob", item: id, knob: "pingpong" })).toBe(false)
  })

  it("enforces what Drift's graph allows", () => {
    let doc = emptyDoc("audio")
    const outer = ok(rack.addSplit(doc, "parallel"))
    doc = outer.doc
    const lane = (rack.findItem(rack.rackOf(doc), outer.id)!.item as SplitBlock).lanes[0].id
    const inner = ok(rack.addSplit(doc, "parallel", 2, { lane }))
    const innerLane = (rack.findItem(rack.rackOf(inner.doc), inner.id)!.item as SplitBlock).lanes[0].id
    expect(rack.addSplit(inner.doc, "parallel", 2, { lane: innerLane })).toHaveProperty("error")
    expect(rack.moveItem(inner.doc, outer.id, { lane: innerLane })).toHaveProperty("error")

    const d2 = ok(rack.addPedal(emptyDoc("audio"), "delay"))
    const m = ok(rack.addModulator(d2.doc, "lfo"))
    expect(rack.addRoute(m.doc, m.id, d2.id, "pingpong")).toHaveProperty("error")

    const two = ok(rack.addSplit(emptyDoc("audio"), "parallel"))
    const crossfaded = ok(rack.setCrossfade(two.doc, two.id, true))
    const three = ok(rack.addLane(crossfaded.doc, two.id))
    // A third lane ends the blend: it only works between two.
    expect((rack.findItem(rack.rackOf(three.doc), two.id)!.item as SplitBlock).crossfade).toBeUndefined()
    expect(rack.setCrossfade(three.doc, two.id, true)).toHaveProperty("error")
  })

  it("removing a pedal takes its modulation with it", () => {
    const d = ok(rack.addPedal(emptyDoc("audio"), "filter"))
    const m = ok(rack.addModulator(d.doc, "lfo"))
    const routed = ok(rack.addRoute(m.doc, m.id, d.id, "cutoff"))
    const e = ok(rack.addModulator(routed.doc, "envelope"))
    const doc = rack.removeItem(rack.setModulatorSource(e.doc, e.id, d.id), d.id)
    expect(rack.rackOf(doc).routes).toEqual([])
    expect(rack.rackOf(doc).modulators.find((x) => x.id === e.id)!.source).toBe("input")
  })

  it("rebuilds the preview only when the board's shape changes", () => {
    const d = ok(rack.addPedal(emptyDoc("audio"), "reverb"))
    const id = d.id
    const sig = rack.rackSignature(d.doc)
    expect(rack.rackSignature(rack.setValue(d.doc, { kind: "knob", item: id, knob: "size" }, 0.9))).toBe(sig)
    expect(rack.rackSignature(rack.setValue(d.doc, { kind: "bypass", item: id }, true))).toBe(sig)
    expect(rack.rackSignature(ok(rack.exposeValue(d.doc, { kind: "knob", item: id, knob: "size" })).doc)).not.toBe(sig)
    expect(rack.rackSignature(ok(rack.addPedal(d.doc, "gain")).doc)).not.toBe(sig)
  })

  it("keeps route depths and lane levels live, but rebuilds when routes come or go", () => {
    const f = ok(rack.addPedal(emptyDoc("audio"), "filter"))
    const s = ok(rack.addSplit(f.doc, "parallel"))
    const m = ok(rack.addModulator(s.doc, "lfo"))
    const routed = ok(rack.addRoute(m.doc, m.id, f.id, "cutoff", 0.3))
    const sig = rack.rackSignature(routed.doc)
    const split = rack.findItem(rack.rackOf(routed.doc), s.id)!.item as SplitBlock
    expect(rack.rackSignature(rack.setValue(routed.doc, { kind: "depth", route: routed.id }, -0.8))).toBe(sig)
    expect(rack.rackSignature(rack.setLaneGain(routed.doc, s.id, split.lanes[0].id, 0.2))).toBe(sig)
    expect(rack.rackSignature(rack.removeRoute(routed.doc, routed.id))).not.toBe(sig)
    expect(rack.rackSignature(ok(rack.exposeValue(routed.doc, { kind: "depth", route: routed.id })).doc)).not.toBe(sig)
  })

  it("moves a pedal within and between lanes", () => {
    let doc = emptyDoc("audio")
    const a = ok(rack.addPedal(doc, "gain"))
    const b = ok(rack.addPedal(a.doc, "pan"))
    const s = ok(rack.addSplit(b.doc, "parallel"))
    doc = ok(rack.moveItem(s.doc, a.id, { lane: null, index: 2 })).doc
    expect(rack.rackOf(doc).chain.map((i) => i.id)).toEqual([b.id, a.id, s.id])
    const lane = (rack.findItem(rack.rackOf(doc), s.id)!.item as SplitBlock).lanes[1].id
    doc = ok(rack.moveItem(doc, b.id, { lane })).doc
    expect(rack.rackOf(doc).chain.map((i) => i.id)).toEqual([a.id, s.id])
    expect(rack.findItem(rack.rackOf(doc), b.id)!.lane!.id).toBe(lane)
  })
})
