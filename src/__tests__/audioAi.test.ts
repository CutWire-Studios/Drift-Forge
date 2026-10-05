import { readFileSync } from "node:fs"
import { beforeAll, describe, expect, it } from "vitest"
import { runAgent, type ModelAdapter, type ModelReply, type ToolCall } from "@/ai/agent"
import { systemPrompt } from "@/ai/prompt"
import { agentTools, runTool, viewGraph } from "@/ai/tools"
import * as rack from "@/audio/rack"
import { loadDriftAudio, WasmGraph, type DriftAudioModule } from "@/audio/wasm/graph"
import { audioPackageJson } from "@/compiler/manifest"
import { isSplit, type ForgeDoc, type SplitBlock } from "@/doc/types"
import { emptyDoc } from "@/doc/util"
import { AUDIO_STARTERS } from "@/starters/audio"

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: Math.random().toString(36).slice(2), name, args })

/** Replays tool calls, feeding ids created earlier into later calls as $1, $2… */
function scripted(steps: ToolCall[][]): ModelAdapter & { seen: string[] } {
  const ids: string[] = []
  const seen: string[] = []
  let i = 0
  return {
    seen,
    async complete({ messages }) {
      const last = messages.at(-1)
      if (last?.role === "tool") {
        for (const r of last.results) {
          seen.push(r.content)
          const m = /^(?:added|route) (\S+)/.exec(r.content)
          if (m) ids.push(m[1])
        }
      }
      const sub = (v: unknown): unknown => (typeof v === "string" && /^\$\d+$/.test(v) ? ids[Number(v.slice(1)) - 1] : v)
      if (i >= steps.length) return { text: "Built it.", calls: [], usage: { input: 10, output: 5 } } satisfies ModelReply
      const calls = steps[i++].map((c) => ({ ...c, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, sub(v)])) }))
      return { text: "", calls, usage: { input: 100, output: 20 } }
    },
  }
}

describe("AI for audio effects", () => {
  let M: DriftAudioModule
  beforeAll(async () => {
    M = await loadDriftAudio(await WebAssembly.compile(readFileSync(new URL("../../public/audio/drift-audio.wasm", import.meta.url))))
  })
  const loads = (doc: ForgeDoc) => {
    const graph = WasmGraph.create(M, JSON.stringify(audioPackageJson(doc)), 48000)
    graph.reset(0)
    const buf = new Float32Array(9600).map((_, i) => Math.sin(i / 9) * 0.5)
    graph.process(buf)
    graph.destroy()
    return buf
  }

  it("offers an audio effect the pedal tools, and each kind only its own", () => {
    const names = agentTools("audio").map((t) => t.name)
    expect(names).toContain("add_pedal")
    expect(names).toContain("check")
    expect(names).not.toContain("add_block")
    expect(agentTools("effect").map((t) => t.name)).not.toContain("add_pedal")

    const audio = emptyDoc("audio")
    expect(runTool(audio, "add_block", { type: "blur" })).toMatchObject({ error: true, result: expect.stringMatching(/pedal tools/) })
    expect(runTool(emptyDoc("effect"), "add_pedal", { type: "reverb" })).toMatchObject({ error: true, result: expect.stringMatching(/audio effects/) })
  })

  it("builds a board from a conversation that Drift's DSP accepts", async () => {
    const model = scripted([
      [call("add_pedal", { type: "filter", settings: { mode: "Band-pass", cutoff: 900, resonance: 3 } })],
      [call("add_split", { mode: "parallel", crossfade: true })],
      [call("add_pedal", { type: "convolution", after: "$1" }), call("add_modulator", { type: "lfo", settings: { rate: 0.5 } })],
      [call("set_ir", { pedal: "$3", space: "hall" }), call("route_modulation", { from: "$4", pedal: "$1", knob: "cutoff", depth: 0.35 })],
      [call("expose_knob", { target: "$2", knob: "blend", label: "Space" }), call("set_knob", { target: "$5", knob: "depth", value: -0.5 })],
      [call("set_details", { name: "Swirl", category: "space" }), call("check")],
    ])
    const run = await runAgent({ adapter: model, doc: emptyDoc("audio"), history: [], prompt: "a swirling filter into a hall" })
    expect(model.seen.filter((s) => /^(No |That |There is no)/.test(s))).toEqual([])
    expect(model.seen.at(-1)).toBe("OK")
    const doc = run.doc
    expect(doc.meta.displayName).toBe("Swirl")
    expect(rack.validateRack(doc)).toEqual([])
    const r = rack.rackOf(doc)
    expect(r.chain.map((i) => i.type)).toEqual(["filter", "convolution", "split"])
    expect(r.routes[0]).toMatchObject({ knob: "cutoff", depth: -0.5 })
    expect(doc.params.map((p) => p.displayName)).toEqual(["Space"])
    expect((r.chain[2] as SplitBlock).blend).toEqual({ param: doc.params[0].identifier })
    // It needs the hall's IR staged to load; the shape is what matters here, so swap in a dry board.
    const dry = rack.removeItem(doc, r.chain[1].id)
    expect(loads(dry).every(Number.isFinite)).toBe(true)
  })

  it("explains mistakes in words the model can act on", () => {
    const d = runTool(emptyDoc("audio"), "add_pedal", { type: "wahwah" })
    expect(d).toMatchObject({ error: true, result: expect.stringMatching(/list_pedals/) })
    const p = runTool(emptyDoc("audio"), "add_pedal", { type: "delay" })
    const id = /^added (\S+)/.exec(p.result)![1]
    expect(runTool(p.doc, "set_knob", { target: id, knob: "colour", value: 1 })).toMatchObject({ error: true, result: expect.stringMatching(/time, feedback/) })
    const m = runTool(p.doc, "add_modulator", { type: "lfo" })
    const mod = /^added (\S+)/.exec(m.result)![1]
    expect(runTool(m.doc, "route_modulation", { from: mod, pedal: id, knob: "pingpong", depth: 0.5 })).toMatchObject({ error: true })
  })

  it("describes the board with its lanes, modulators and status", () => {
    let doc = emptyDoc("audio")
    const s = runTool(doc, "add_split", { mode: "bands", lanes: 3 })
    doc = s.doc
    const lane = (rack.rackOf(doc).chain[0] as SplitBlock).lanes[0].id
    doc = runTool(doc, "add_pedal", { type: "classic.compressor", lane }).doc
    const text = viewGraph(doc)
    expect(text).toMatch(/split bands \{crossover1=\d+Hz, crossover2=\d+Hz\}/)
    expect(text).toMatch(/lane1 \S+:\n\s+\S+ classic\.compressor/)
    expect(text).toMatch(/lane2 \S+: \(dry\)/)
    expect(text).toMatch(/status: OK$/)
  })

  it("starts from starters that load and make sound", () => {
    for (const s of AUDIO_STARTERS) {
      expect(rack.validateRack(s.doc), s.name).toEqual([])
      const out = loads(s.doc)
      expect(out.some((v) => Math.abs(v) > 0.01), s.name).toBe(true)
      expect(rack.allItems(rack.rackOf(s.doc)).every((i) => isSplit(i) || i.type !== "convolution"), s.name).toBe(true)
    }
  })

  it("keeps the audio prompt small and grounded in the real catalog", () => {
    const prompt = systemPrompt(emptyDoc("audio"))
    expect(prompt.length).toBeLessThan(9000)
    expect(prompt).toMatch(/classic\.pitch/)
    expect(prompt).toMatch(/hall \(concert hall\)/)
  })
})
