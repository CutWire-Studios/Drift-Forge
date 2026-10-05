import type { ForgeDoc } from "@/doc/types"
import { placeNew } from "./layout"
import { systemPrompt } from "./prompt"
import { agentTools, runTool, viewGraph, type ToolSpec } from "./tools"

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
  /** the model's reasoning for this step, when the provider exposes it */
  thinking?: string
  calls: ToolCall[]
  raw?: unknown
  /** `neurons` is reported by Workers AI itself */
  usage?: { input: number; output: number; neurons?: number }
}

/** A piece of the model's reasoning or reply, as it's written. */
export interface Delta {
  channel: "thinking" | "text"
  text: string
}

export interface ModelAdapter {
  complete(req: { system: string; messages: AgentMessage[]; tools: ToolSpec[]; onDelta?: (d: Delta) => void }): Promise<ModelReply>
}

/** A previous exchange shown to the model as plain text (never tool calls). */
export interface ChatTurn {
  role: "user" | "assistant"
  text: string
}

export interface Question {
  question: string
  options: string[]
}

export interface Plan {
  feasibility: "possible" | "partly" | "not_possible"
  summary: string
  steps: string[]
  limitations: string[]
  question: string
}

/** The run is waiting for the user: questions to answer, or a plan to confirm. */
export type Pending = { kind: "questions"; questions: Question[] } | { kind: "plan"; plan: Plan }

export type AgentEvent =
  | { type: "delta"; channel: Delta["channel"]; text: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; result: string; error?: boolean }
  | { type: "pending"; pending: Pending }

export interface AgentRun {
  doc: ForgeDoc
  reply: string
  pending?: Pending
  steps: number
  usage: { input: number; output: number }
  /** tool names in call order */
  log: string[]
  /** set when the run ended early (step limit, budget) */
  stopped?: string
}

/** Throw from `beforeCall` to end a run early while keeping the work done so far. */
export class StopRun extends Error {}

export interface AgentOptions {
  adapter: ModelAdapter
  doc: ForgeDoc
  prompt: string
  history?: ChatTurn[]
  maxSteps?: number
  /** called after every tool round with the document so far */
  onStep?: (doc: ForgeDoc, log: string[]) => void
  onEvent?: (e: AgentEvent) => void
  /** throw StopRun to stop before a model call (e.g. out of budget); other errors propagate */
  beforeCall?: (step: number, messages: AgentMessage[]) => Promise<void> | void
  afterCall?: (reply: ModelReply) => Promise<void> | void
  /** caps applied to everything the model can show (hosted AI) */
  limits?: { thinking: number; text: number }
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
const list = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n)

function parseQuestions(args: Record<string, unknown>): Question[] {
  return (Array.isArray(args.questions) ? args.questions : [])
    .slice(0, 3)
    .map((q) => {
      const o = (q && typeof q === "object" ? q : { question: q }) as Record<string, unknown>
      return { question: str(o.question, 300), options: list(o.options, 5, 80) }
    })
    .filter((q) => q.question)
}

function parsePlan(args: Record<string, unknown>): Plan {
  const f = args.feasibility
  return {
    feasibility: f === "partly" || f === "not_possible" ? f : "possible",
    summary: str(args.summary, 600),
    steps: list(args.steps, 12, 160),
    limitations: list(args.limitations, 6, 200),
    question: str(args.question, 200) || "Shall I build it?",
  }
}

/** How a waiting turn reads in the plain-text history the model sees next time. */
export function pendingAsText(p: Pending): string {
  if (p.kind === "questions") {
    return `I asked: ${p.questions.map((q, i) => `${i + 1}. ${q.question}${q.options.length ? ` (suggested: ${q.options.join(" / ")})` : ""}`).join(" ")}`
  }
  const { plan } = p
  return [
    `Proposed plan (feasibility: ${plan.feasibility}): ${plan.summary}`,
    plan.steps.length ? `Steps: ${plan.steps.map((s, i) => `${i + 1}) ${s}`).join(" ")}` : "",
    plan.limitations.length ? `Limitations: ${plan.limitations.join("; ")}` : "",
    plan.question,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function runAgent(o: AgentOptions): Promise<AgentRun> {
  const maxSteps = o.maxSteps ?? 20
  const limits = o.limits ?? { thinking: 20_000, text: 4_000 }
  let doc = o.doc
  const created = new Set<string>()
  const log: string[] = []
  const usage = { input: 0, output: 0 }
  const messages: AgentMessage[] = [
    ...(o.history ?? []).map((t): AgentMessage => (t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text, calls: [] })),
    { role: "user", text: `Current ${doc.kind === "audio" ? "board" : "graph"}:\n${viewGraph(doc)}\n\nRequest: ${o.prompt}` },
  ]

  let reply = ""
  let pending: Pending | undefined
  let stopped: string | undefined
  let steps = 0
  for (; steps < maxSteps; steps++) {
    try {
      await o.beforeCall?.(steps, messages)
    } catch (e) {
      if (!(e instanceof StopRun)) throw e
      stopped = e.message
      break
    }
    // Stream what the model writes, within the same caps as the finished step.
    const shown = { thinking: 0, text: 0 }
    const cap = { thinking: limits.thinking, text: limits.text }
    const onDelta = o.onEvent
      ? (d: Delta) => {
          const room = cap[d.channel] - shown[d.channel]
          if (room <= 0 || !d.text) return
          const text = d.text.slice(0, room)
          shown[d.channel] += text.length
          o.onEvent!({ type: "delta", channel: d.channel, text })
        }
      : undefined
    const res = await o.adapter.complete({ system: systemPrompt(doc), messages, tools: agentTools(doc.kind), onDelta })
    if (res.usage) {
      usage.input += res.usage.input
      usage.output += res.usage.output
    }
    await o.afterCall?.(res)
    // Providers that don't stream deliver it all at once here instead.
    if (res.thinking?.trim() && !shown.thinking) o.onEvent?.({ type: "thinking", text: res.thinking.trim().slice(0, limits.thinking) })
    if (res.text.trim() && res.calls.length && !shown.text) o.onEvent?.({ type: "text", text: res.text.trim().slice(0, limits.text) })
    messages.push({ role: "assistant", text: res.text, calls: res.calls, raw: res.raw })
    if (!res.calls.length) {
      reply = res.text
      break
    }
    const results = []
    for (const c of res.calls) {
      if (c.name === "ask_user" || c.name === "propose_plan") {
        const questions = c.name === "ask_user" ? parseQuestions(c.args) : []
        pending = c.name === "ask_user" ? { kind: "questions", questions } : { kind: "plan", plan: parsePlan(c.args) }
        if (pending.kind === "questions" && !questions.length) {
          pending = undefined
          results.push({ id: c.id, name: c.name, content: "Give at least one question.", error: true })
          continue
        }
        results.push({ id: c.id, name: c.name, content: "Shown to the user. Wait for their answer." })
        continue
      }
      const r = runTool(doc, c.name, c.args)
      doc = r.doc
      for (const id of r.created ?? []) created.add(id)
      log.push(c.name)
      o.onEvent?.({ type: "tool", name: c.name, result: r.result.slice(0, 300), error: r.error })
      results.push({ id: c.id, name: c.name, content: r.result, error: r.error })
    }
    messages.push({ role: "tool", results })
    o.onStep?.(placeNew(doc, created), log)
    if (pending) {
      o.onEvent?.({ type: "pending", pending })
      reply = res.text
      break
    }
  }
  if (!reply && !pending && !stopped && steps >= maxSteps) stopped = `I stopped after ${maxSteps} steps. Ask me to continue if it isn't finished.`
  if (stopped && !reply) reply = stopped

  return { doc: placeNew(doc, created), reply: reply.trim().slice(0, limits.text), pending, steps, usage, log, stopped }
}
