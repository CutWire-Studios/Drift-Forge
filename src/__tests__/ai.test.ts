import { describe, expect, it } from "vitest"
import { runAgent, type AgentEvent, type ModelAdapter, type ModelReply, type ToolCall } from "@/core/ai/agent"
import { fromOpenAI, readChatResponse } from "@/core/ai/providers/openaiFormat"
import { runTool, viewGraph } from "@/core/ai/tools"
import { compile } from "@/core/compiler/compile"
import { emptyDoc } from "@/core/doc/util"
import { createNode, outputType } from "@/core/nodes/registry"
import type { ForgeDoc, Kind } from "@/core/doc/types"

function blank(kind: Kind): ForgeDoc {
  const d = emptyDoc(kind)
  d.nodes.push(createNode(outputType(kind), 600, 0))
  return d
}

/** Runs tool calls, feeding each id an earlier call created into later ones via $1, $2… */
function scripted(steps: ToolCall[][], final = "Done."): ModelAdapter & { seen: string[] } {
  const ids: string[] = []
  let i = 0
  const seen: string[] = []
  return {
    seen,
    async complete({ messages }) {
      const last = messages.at(-1)
      if (last?.role === "tool") {
        for (const r of last.results) {
          seen.push(r.content)
          const m = /^added (\S+)/.exec(r.content)
          if (m) ids.push(m[1])
        }
      }
      const sub = (v: unknown): unknown => (typeof v === "string" && /^\$\d+$/.test(v) ? ids[Number(v.slice(1)) - 1] : v)
      if (i >= steps.length) return { text: final, calls: [], usage: { input: 10, output: 5 } } satisfies ModelReply
      const calls = steps[i++].map((c) => ({ ...c, args: Object.fromEntries(Object.entries(c.args).map(([k, v]) => [k, sub(v)])) }))
      return { text: "", calls, usage: { input: 100, output: 20 } }
    },
  }
}

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: Math.random().toString(36).slice(2), name, args })

describe("tools", () => {
  it("builds a glowing wipe transition by tool calls", () => {
    let d = blank("transition")
    const out = d.nodes[0].id
    const ids: Record<string, string> = {}
    const add = (key: string, type: string, settings?: Record<string, unknown>) => {
      const r = runTool(d, "add_block", { type, settings })
      expect(r.error).toBeFalsy()
      d = r.doc
      ids[key] = r.created![0]
    }
    add("from", "from")
    add("to", "to")
    add("wipe", "wipe_mask", { softness: 0.1, angle: 45 })
    add("mix", "mix")
    for (const [f, o, t, i] of [
      ["from", "image", "mix", "a"],
      ["to", "image", "mix", "b"],
      ["wipe", "mask", "mix", "amount"],
    ]) {
      const r = runTool(d, "connect", { from: ids[f], output: o, to: ids[t], input: i })
      expect(r.error, r.result).toBeFalsy()
      d = r.doc
    }
    d = runTool(d, "connect", { from: ids.mix, to: out }).doc
    const exposed = runTool(d, "expose_setting", { block: ids.wipe, setting: "angle", label: "Direction" })
    expect(exposed.result).toBe("slider direction")
    d = exposed.doc
    expect(runTool(d, "check", {}).result).toMatch(/^OK/)
    expect(compile(d, { mode: "export" }).ok).toBe(true)
    expect(viewGraph(d)).toContain("status: OK")
  })

  it("explains mistakes instead of throwing", () => {
    const d = blank("effect")
    expect(runTool(d, "add_block", { type: "nope" }).result).toMatch(/list_blocks/)
    expect(runTool(d, "add_block", { type: "progress" }).result).toMatch(/can't be used in an effect/)
    const v = runTool(d, "add_block", { type: "blur" })
    expect(runTool(v.doc, "set_setting", { block: v.created![0], setting: "radius", value: "lots" }).result).toBe("Give a number.")
    expect(runTool(v.doc, "set_setting", { block: v.created![0], setting: "colour", value: 1 }).result).toMatch(/has no setting/)
    expect(runTool(d, "remove_block", { block: d.nodes[0].id }).result).toMatch(/can't be removed/)
    expect(runTool(d, "frobnicate", {}).error).toBe(true)
  })

  it("parses colours, points and options", () => {
    let d = blank("effect")
    const tint = runTool(d, "add_block", { type: "tint", settings: { color: "#ff8800", amount: 0.5 } })
    expect(tint.result).not.toMatch(/not set/)
    d = tint.doc
    const id = tint.created![0]
    expect(d.nodes.find((n) => n.id === id)!.inputs.color).toEqual([1, 136 / 255, 0, 1])
    const tw = runTool(d, "add_block", { type: "twirl", settings: { center: [0.3, 0.7], edge: "Transparent" } })
    const node = tw.doc.nodes.find((n) => n.id === tw.created![0])!
    expect(node.inputs.center).toEqual([0.3, 0.7])
    expect(node.data.edge).toBe("transparent")
  })
})

describe("agent", () => {
  it("runs tool rounds, lays out new blocks and returns the reply", async () => {
    const adapter = scripted([
      [call("add_block", { type: "video" }), call("add_block", { type: "glow" })],
      [call("connect", { from: "$1", to: "$2" })],
      [call("view_graph")],
    ])
    const doc = blank("effect")
    const out = doc.nodes[0].id
    // The Output's id is fixed; wire it in the third step.
    let stepped = 0
    const run = await runAgent({ adapter, doc, prompt: "make it dreamy", onStep: () => stepped++ })
    expect(run.reply).toBe("Done.")
    expect(run.log).toEqual(["add_block", "add_block", "connect", "view_graph"])
    expect(stepped).toBe(3)
    expect(run.usage).toEqual({ input: 310, output: 65 })
    const placed = run.doc.nodes.filter((n) => n.id !== out)
    expect(new Set(placed.map((n) => `${n.x},${n.y}`)).size).toBe(placed.length)
    const glow = run.doc.nodes.find((n) => n.type === "glow")!
    const video = run.doc.nodes.find((n) => n.type === "video")!
    expect(glow.x).toBeGreaterThan(video.x)
    expect(run.doc.nodes.find((n) => n.id === out)!.x).toBeGreaterThan(glow.x)
  })

  it("stops at the step limit", async () => {
    const adapter: ModelAdapter = { complete: async () => ({ text: "", calls: [call("view_graph")] }) }
    const run = await runAgent({ adapter, doc: blank("effect"), prompt: "x", maxSteps: 3 })
    expect(run.steps).toBe(3)
    expect(run.reply).toMatch(/stopped after 3 steps/)
  })

  it("lets the caller stop before a model call", async () => {
    const adapter: ModelAdapter = { complete: async () => ({ text: "hi", calls: [] }) }
    await expect(
      runAgent({ adapter, doc: blank("effect"), prompt: "x", beforeCall: () => { throw new Error("over budget") } }),
    ).rejects.toThrow("over budget")
  })
})

describe("model replies", () => {
  it("recovers tool calls Gemma writes in its own template format", () => {
    const r = fromOpenAI({
      choices: [{ message: { content: null, reasoning: 'Next.<|tool_call>call:set_setting{block:<|"|>b1<|"|>,setting:<|"|>amount, more<|"|>,value:0.25}<tool_call|>' } }],
    })
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0].name).toBe("set_setting")
    expect(r.calls[0].args).toEqual({ block: "b1", setting: "amount, more", value: 0.25 })
    expect(r.thinking).toBe("Next.")
  })

  it("describes several blocks in one call", () => {
    const r = runTool(blank("effect"), "describe_block", { types: ["wave", "nope"] })
    expect(r.result).toContain("wave")
    expect(r.result).toContain('No block type "nope"')
  })
})

describe("streaming", () => {
  const sse = (chunks: unknown[]) =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    })

  it("reads a streamed answer: reasoning once, split tool arguments, the total usage", async () => {
    const deltas: string[] = []
    const res = await readChatResponse(
      sse([
        { choices: [{ delta: { role: "assistant", content: "" } }], usage: { prompt_tokens: 164, completion_tokens: 0, total_tokens: 164 } },
        { choices: [{ delta: { reasoning: "Add ", reasoning_content: "Add " } }], usage: { total_tokens: 1 } },
        { choices: [{ delta: { reasoning: "glow.", reasoning_content: null } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "add_block", arguments: '{"type":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ' "glow"}' } }] } }] },
        { response: "", usage: { prompt_tokens: 164, completion_tokens: 80, total_tokens: 244, neurons: 3.8 } },
      ]),
      (d) => deltas.push(`${d.channel}:${d.text}`),
    )
    const r = fromOpenAI(res)
    expect(deltas).toEqual(["thinking:Add ", "thinking:glow."])
    expect(r.thinking).toBe("Add glow.")
    expect(r.calls).toMatchObject([{ id: "t1", name: "add_block", args: { type: "glow" } }])
    expect(r.usage).toEqual({ input: 164, output: 80, neurons: 3.8 })
  })

  it("caps what streams to the limits of a finished step", async () => {
    const adapter: ModelAdapter = {
      complete: async ({ onDelta }) => {
        for (let i = 0; i < 10; i++) onDelta?.({ channel: "thinking", text: "abcdef" })
        onDelta?.({ channel: "text", text: "x".repeat(50) })
        return { text: "x".repeat(50), thinking: "abcdef".repeat(10), calls: [] }
      },
    }
    const events: AgentEvent[] = []
    const run = await runAgent({ adapter, doc: blank("effect"), prompt: "hi", limits: { thinking: 20, text: 30 }, onEvent: (e) => events.push(e) })
    const streamed = (ch: string) => events.filter((e) => e.type === "delta" && e.channel === ch).map((e) => (e as { text: string }).text).join("")
    expect(streamed("thinking")).toBe("abcdef".repeat(10).slice(0, 20))
    expect(streamed("text")).toHaveLength(30)
    expect(events.some((e) => e.type === "thinking")).toBe(false)
    expect(run.reply).toHaveLength(30)
  })
})
