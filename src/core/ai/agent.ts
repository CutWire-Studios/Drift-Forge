import type { ForgeDoc, Kind } from "@/core/doc/types"
import { placeNew } from "./layout"
import { systemPrompt } from "./prompt"
import { agentTools, conversationTool, runTool, viewGraph, type Pending, type ToolSpec } from "./tools"

export type { Pending, Plan, Question } from "./tools"

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

/** What the model is shown the document as, in the first message of a run. */
const DOC_NOUN: Record<Kind, string> = { effect: "graph", transition: "graph", audio: "board" }

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

type Limits = NonNullable<AgentOptions["limits"]>
type ToolResult = Extract<AgentMessage, { role: "tool" }>["results"][number]

/** What a run has built up across its tool rounds. */
interface RunState {
  doc: ForgeDoc
  created: Set<string>
  log: string[]
  pending?: Pending
}

function initialMessages(o: AgentOptions): AgentMessage[] {
  return [
    ...(o.history ?? []).map((t): AgentMessage => (t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text, calls: [] })),
    { role: "user", text: `Current ${DOC_NOUN[o.doc.kind]}:\n${viewGraph(o.doc)}\n\nRequest: ${o.prompt}` },
  ]
}

/** Streams what the model writes, within the same caps as the finished step. */
function deltaStream(onEvent: AgentOptions["onEvent"], limits: Limits) {
  const shown = { thinking: 0, text: 0 }
  const onDelta = onEvent
    ? (d: Delta) => {
        const room = limits[d.channel] - shown[d.channel]
        if (room <= 0 || !d.text) return
        const text = d.text.slice(0, room)
        shown[d.channel] += text.length
        onEvent({ type: "delta", channel: d.channel, text })
      }
    : undefined
  return { shown, onDelta }
}

/** Providers that don't stream deliver it all at once instead. */
function reportUnstreamed(o: AgentOptions, res: ModelReply, shown: { thinking: number; text: number }, limits: Limits) {
  if (res.thinking?.trim() && !shown.thinking) o.onEvent?.({ type: "thinking", text: res.thinking.trim().slice(0, limits.thinking) })
  if (res.text.trim() && res.calls.length && !shown.text) o.onEvent?.({ type: "text", text: res.text.trim().slice(0, limits.text) })
}

function runCall(o: AgentOptions, state: RunState, c: ToolCall): ToolResult {
  const conversation = conversationTool(c.name)
  if (conversation) {
    const p = conversation.pending(c.args)
    if ("error" in p) return { id: c.id, name: c.name, content: p.error, error: true }
    state.pending = p
    return { id: c.id, name: c.name, content: "Shown to the user. Wait for their answer." }
  }
  const r = runTool(state.doc, c.name, c.args)
  state.doc = r.doc
  for (const id of r.created ?? []) state.created.add(id)
  state.log.push(c.name)
  o.onEvent?.({ type: "tool", name: c.name, result: r.result.slice(0, 300), error: r.error })
  return { id: c.id, name: c.name, content: r.result, error: r.error }
}

/** Runs `beforeCall`; a StopRun comes back as its message. */
async function checkBefore(o: AgentOptions, step: number, messages: AgentMessage[]): Promise<string | undefined> {
  try {
    await o.beforeCall?.(step, messages)
  } catch (e) {
    if (!(e instanceof StopRun)) throw e
    return e.message
  }
  return undefined
}

/** One model call and its tool round; returns the reply once the run should end, else null. */
async function modelStep(o: AgentOptions, state: RunState, messages: AgentMessage[], limits: Limits, usage: AgentRun["usage"]): Promise<string | null> {
  const { shown, onDelta } = deltaStream(o.onEvent, limits)
  const res = await o.adapter.complete({ system: systemPrompt(state.doc), messages, tools: agentTools(state.doc.kind), onDelta })
  usage.input += res.usage?.input ?? 0
  usage.output += res.usage?.output ?? 0
  await o.afterCall?.(res)
  reportUnstreamed(o, res, shown, limits)
  messages.push({ role: "assistant", text: res.text, calls: res.calls, raw: res.raw })
  if (!res.calls.length) return res.text
  messages.push({ role: "tool", results: res.calls.map((c) => runCall(o, state, c)) })
  o.onStep?.(placeNew(state.doc, state.created), state.log)
  if (!state.pending) return null
  o.onEvent?.({ type: "pending", pending: state.pending })
  return res.text
}

export async function runAgent(o: AgentOptions): Promise<AgentRun> {
  const maxSteps = o.maxSteps ?? 20
  const limits = o.limits ?? { thinking: 20_000, text: 4_000 }
  const state: RunState = { doc: o.doc, created: new Set(), log: [] }
  const usage = { input: 0, output: 0 }
  const messages = initialMessages(o)

  let reply: string | null = null
  let stopped: string | undefined
  let steps = 0
  for (; steps < maxSteps && reply === null; steps++) {
    stopped = await checkBefore(o, steps, messages)
    if (stopped) break
    reply = await modelStep(o, state, messages, limits, usage)
  }
  // The loop counts the step that ended it; the run reports steps taken before ending.
  if (reply !== null) steps--
  if (reply === null && !stopped) stopped = `I stopped after ${maxSteps} steps. Ask me to continue if it isn't finished.`
  const text = reply || stopped || ""

  const { pending, log } = state
  return { doc: placeNew(state.doc, state.created), reply: text.trim().slice(0, limits.text), pending, steps, usage, log, stopped }
}
