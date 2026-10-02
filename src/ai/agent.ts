import type { ForgeDoc } from "@/doc/types"
import { placeNew } from "./layout"
import { systemPrompt } from "./prompt"
import { runTool, TOOLS, viewGraph, type ToolSpec } from "./tools"

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Provider-neutral conversation. `raw` keeps provider content that must be echoed back as-is. */
export type AgentMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; content: string; error?: boolean }[] }

export interface ModelReply {
  text: string
  calls: ToolCall[]
  raw?: unknown
  usage?: { input: number; output: number }
}

export interface ModelAdapter {
  complete(req: { system: string; messages: AgentMessage[]; tools: ToolSpec[] }): Promise<ModelReply>
}

/** A previous exchange shown to the model as plain text (never tool calls). */
export interface ChatTurn {
  role: "user" | "assistant"
  text: string
}

export interface AgentRun {
  doc: ForgeDoc
  reply: string
  steps: number
  usage: { input: number; output: number }
  /** tool names in call order, for showing progress */
  log: string[]
}

export interface AgentOptions {
  adapter: ModelAdapter
  doc: ForgeDoc
  prompt: string
  history?: ChatTurn[]
  maxSteps?: number
  /** called after every tool round with the document so far */
  onStep?: (doc: ForgeDoc, log: string[]) => void
  /** throw from here to stop before a model call (e.g. out of budget) */
  beforeCall?: (step: number, messages: AgentMessage[]) => Promise<void> | void
  afterCall?: (usage: { input: number; output: number } | undefined, reply: ModelReply) => Promise<void> | void
}

export async function runAgent(o: AgentOptions): Promise<AgentRun> {
  const maxSteps = o.maxSteps ?? 12
  let doc = o.doc
  const created = new Set<string>()
  const log: string[] = []
  const usage = { input: 0, output: 0 }
  const messages: AgentMessage[] = [
    ...(o.history ?? []).map((t): AgentMessage => (t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text, calls: [] })),
    { role: "user", text: `Current graph:\n${viewGraph(doc)}\n\nRequest: ${o.prompt}` },
  ]

  let reply = ""
  let steps = 0
  for (; steps < maxSteps; steps++) {
    await o.beforeCall?.(steps, messages)
    const res = await o.adapter.complete({ system: systemPrompt(doc), messages, tools: TOOLS })
    if (res.usage) {
      usage.input += res.usage.input
      usage.output += res.usage.output
    }
    await o.afterCall?.(res.usage, res)
    messages.push({ role: "assistant", text: res.text, calls: res.calls, raw: res.raw })
    if (!res.calls.length) {
      reply = res.text
      break
    }
    const results = res.calls.map((c) => {
      const r = runTool(doc, c.name, c.args)
      doc = r.doc
      for (const id of r.created ?? []) created.add(id)
      log.push(c.name)
      return { id: c.id, name: c.name, content: r.result, error: r.error }
    })
    messages.push({ role: "tool", results })
    o.onStep?.(placeNew(doc, created), log)
  }
  if (steps >= maxSteps && !reply) reply = `I stopped after ${maxSteps} steps. Ask me to continue if it isn't finished.`

  return { doc: placeNew(doc, created), reply: reply.trim(), steps, usage, log }
}
