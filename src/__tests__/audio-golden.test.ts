// The preview's wasm build of Drift's audio DSP against Drift itself: every golden manifest is run
// through public/audio/drift-audio.wasm and compared with what the native build rendered
// (scripts/update-audio-goldens.sh). A failure means the preview no longer sounds like Drift.
import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { loadDriftAudio, stageFile, WasmGraph } from "@/audio/wasm/graph"

const golden = new URL("./golden/", import.meta.url)
const read = (name: string) => readFileSync(new URL(name, golden))
const floats = (name: string) => {
  const bytes = read(name)
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice()
}

const info = JSON.parse(read("golden.json").toString()) as { driftCommit: string; rate: number }
const build = JSON.parse(readFileSync(new URL("../../public/audio/build.json", import.meta.url)).toString()) as {
  driftCommit: string
}
const manifests = readdirSync(golden).filter((f) => f.endsWith(".json") && f !== "golden.json")

// Native SoundTouch is the system library, with SSE paths the wasm build cannot take, so pitch is
// held to an inaudible error level rather than near-identical samples.
const LOOSE = new Set(["pitch.json"])

describe("audio wasm matches Drift's native DSP", async () => {
  const M = await loadDriftAudio(await WebAssembly.compile(readFileSync(new URL("../../public/audio/drift-audio.wasm", import.meta.url))))
  stageFile(M, "ir/room.wav", new Uint8Array(read("ir/room.wav")))

  it("goldens and module come from the same Drift sources", () => {
    expect(build.driftCommit).toBe(info.driftCommit)
  })

  for (const name of manifests) {
    it(name, () => {
      const graph = WasmGraph.create(M, read(name).toString(), info.rate)
      graph.reset(0)
      const out = floats("input.f32")
      // The worklet's quantum, against the 1000-frame chunks the goldens were rendered in.
      for (let offset = 0; offset < out.length; offset += 256) graph.process(out.subarray(offset, offset + 256))
      graph.destroy()

      const expected = floats(name.replace(/\.json$/, ".f32"))
      expect(out.length).toBe(expected.length)
      let worst = 0
      let error = 0
      let signal = 0
      for (let i = 0; i < out.length; i++) {
        expect(Number.isFinite(out[i])).toBe(true)
        const d = out[i] - expected[i]
        worst = Math.max(worst, Math.abs(d))
        error += d * d
        signal += expected[i] * expected[i]
      }
      expect(signal).toBeGreaterThan(0)
      if (LOOSE.has(name)) expect(10 * Math.log10(error / signal)).toBeLessThan(-80)
      else expect(worst).toBeLessThan(5e-5)
    })
  }
})
