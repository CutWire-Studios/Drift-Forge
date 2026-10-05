import { readFileSync } from "node:fs"
import { unzipSync } from "fflate"
import { beforeAll, describe, expect, it } from "vitest"
import { BUILTIN_IRS, irFiles } from "@/audio/irs"
import * as rack from "@/audio/rack"
import { loadDriftAudio, stageFile, WasmGraph, type DriftAudioModule } from "@/audio/wasm/graph"
import { audioPackageJson } from "@/compiler/manifest"
import { isOpError } from "@/doc/ops"
import type { ForgeDoc } from "@/doc/types"
import { bytesToBase64, emptyDoc } from "@/doc/util"
import { exportZip } from "@/export/archive"

const fromDisk = async (name: string) => new Uint8Array(readFileSync(new URL(`../../public/audio/ir/${name}.wav`, import.meta.url)))

function convolutionDoc(ir?: string): { doc: ForgeDoc; id: string } {
  const r = rack.addPedal(emptyDoc("audio"), "convolution")
  if (isOpError(r)) throw new Error(r.error)
  return { doc: ir ? rack.setIr(r.doc, r.id, ir) : r.doc, id: r.id }
}

describe("convolution impulse responses", () => {
  let M: DriftAudioModule
  beforeAll(async () => {
    M = await loadDriftAudio(await WebAssembly.compile(readFileSync(new URL("../../public/audio/drift-audio.wasm", import.meta.url))))
  })

  it("every built-in loads in Drift's reader and turns a click into a tail", async () => {
    for (const b of BUILTIN_IRS) {
      const { doc } = convolutionDoc(`builtin:${b.id}`)
      for (const [path, data] of await irFiles(doc, fromDisk)) stageFile(M, path, data)
      const graph = WasmGraph.create(M, JSON.stringify(audioPackageJson(doc)), 48000)
      graph.setKnob(graph.nodeIndex(doc.audio!.rack.chain[0].id), 0, 1) // mix: all wet
      graph.reset(0)
      const buf = new Float32Array(48000 * 2)
      buf[0] = buf[1] = 1
      graph.process(buf)
      graph.destroy()
      M._dg_clear_files()
      expect(buf.every(Number.isFinite), b.id).toBe(true)
      // Still ringing a tenth of a second after the click: it's a space, not a pass-through.
      let late = 0
      for (let i = 4800 * 2; i < 9600 * 2; i++) late = Math.max(late, Math.abs(buf[i]))
      expect(late, b.id).toBeGreaterThan(1e-4)
    }
  })

  it("packs the impulse response next to audio-effect.json", async () => {
    const { doc } = convolutionDoc("builtin:hall")
    const json = audioPackageJson(doc)
    expect((json.graph as { chain: { ir: string }[] }).chain[0].ir).toBe("ir/hall.wav")
    const zip = unzipSync(exportZip(doc, { png: null, irs: await irFiles(doc, fromDisk) }))
    expect(zip[`${doc.meta.id}/ir/hall.wav`]).toEqual(await fromDisk("hall"))
    expect(() => exportZip(doc, { png: null })).toThrow(/impulse response/)
  })

  it("carries a recording of the user's own as an asset", async () => {
    const wav = await fromDisk("room")
    const base = convolutionDoc().doc
    const doc: ForgeDoc = { ...base, assets: [{ id: "ir_mine", name: "Stairwell", mime: "audio/wav", data: bytesToBase64(wav), width: 0, height: 0 }] }
    const withIr = rack.setIr(doc, doc.audio!.rack.chain[0].id, "ir_mine")
    expect(rack.validateRack(withIr)).toEqual([])
    const files = await irFiles(withIr, fromDisk)
    expect([...files.keys()]).toEqual(["ir/ir_mine.wav"])
    expect(files.get("ir/ir_mine.wav")).toEqual(wav)

    const gone = { ...withIr, assets: [] }
    expect(rack.validateRack(gone)).toEqual(["A convolution reverb's impulse response is missing."])
  })
})
