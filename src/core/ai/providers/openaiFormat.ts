import type { AgentMessage, Delta, ModelReply, ToolCall } from "@/core/ai/agent"
import type { ToolSpec } from "@/core/ai/tools"

/** Chat-completions message list (OpenAI, OpenAI-compatible servers, Workers AI). */
export function toOpenAIMessages(system: string, messages: AgentMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }]
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text })
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.calls.length
          ? {
              tool_calls: m.calls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      })
    } else {
      for (const r of m.results) out.push({ role: "tool", tool_call_id: r.id, content: r.content })
    }
  }
  return out
}

export function toOpenAITools(tools: ToolSpec[]) {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
}

interface ChatCompletion {
  choices?: {
    message?: {
      content?: string | null
      /** Workers AI and vLLM-style servers */
      reasoning?: string | null
      /** DeepSeek / Ollama-style servers */
      reasoning_content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string | object } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; neurons?: number }
}

interface ChunkCall {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string | object }
}

type StreamChunk = { choices?: { delta?: Record<string, unknown> }[]; usage?: ChatCompletion["usage"] }

/** Builds a non-streamed completion out of streamed deltas, forwarding text as it comes. */
class ChunkAccumulator {
  content = ""
  reasoning = ""
  calls: { id?: string; name?: string; args: string }[] = []
  usage: ChatCompletion["usage"]

  constructor(private onDelta?: (d: Delta) => void) {}

  add(data: string) {
    let c: StreamChunk
    try {
      c = JSON.parse(data)
    } catch {
      return
    }
    // Some servers send running increments as well as the total; the total is the largest.
    if (c.usage && (c.usage.total_tokens ?? 0) >= (this.usage?.total_tokens ?? 0)) this.usage = c.usage
    const d = c.choices?.[0]?.delta
    if (!d) return
    // Workers AI sends the same reasoning under both names.
    this.addText("thinking", (d.reasoning_content ?? d.reasoning) as string | null | undefined)
    if (typeof d.content === "string") this.addText("text", d.content)
    for (const t of (d.tool_calls as ChunkCall[] | undefined) ?? []) this.addCall(t)
  }

  private addText(channel: Delta["channel"], text: string | null | undefined) {
    if (!text) return
    if (channel === "thinking") this.reasoning += text
    else this.content += text
    this.onDelta?.({ channel, text })
  }

  private addCall(t: ChunkCall) {
    const cur = (this.calls[t.index ?? this.calls.length] ??= { args: "" })
    if (t.id) cur.id = t.id
    if (t.function?.name && !cur.name) cur.name = t.function.name
    const a = t.function?.arguments
    if (a && typeof a === "object") cur.args = JSON.stringify(a)
    else if (a) cur.args += a
  }

  result(): ChatCompletion {
    const { content, reasoning, usage } = this
    const tool_calls = this.calls.filter(Boolean).map((c) => ({ id: c.id, function: { name: c.name, arguments: c.args } }))
    return { choices: [{ message: { content, reasoning, tool_calls } }], usage }
  }
}

/** The `data:` payloads of a server-sent event stream. */
async function* eventData(body: ReadableStream<Uint8Array<ArrayBuffer>>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buf += value
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith("data:") && line !== "data: [DONE]") yield line.slice(5).trim()
    }
  }
}

/**
 * Reads a chat-completions answer, streamed (server-sent events) or not, passing reasoning and
 * reply text to `onDelta` as it arrives, and returns it in the non-streamed shape.
 */
export async function readChatResponse(res: Response, onDelta?: (d: Delta) => void): Promise<ChatCompletion> {
  if (!res.headers.get("content-type")?.includes("event-stream") || !res.body) {
    const body = (await res.json()) as ChatCompletion & { result?: ChatCompletion }
    return body.result ?? body
  }
  const acc = new ChunkAccumulator(onDelta)
  for await (const data of eventData(res.body)) acc.add(data)
  return acc.result()
}

function parseArgs(a: unknown): Record<string, unknown> {
  if (a && typeof a === "object") return a as Record<string, unknown>
  if (typeof a !== "string" || !a.trim()) return {}
  try {
    const v = JSON.parse(a)
    return v && typeof v === "object" ? v : {}
  } catch {
    return {}
  }
}

/**
 * Gemma sometimes writes a tool call in its own template format instead of a real one:
 * `<|tool_call>call:add_block{type:<|"|>wave<|"|>,amount:0.2}<tool_call|>`.
 */
const GEMMA_CALL = /<\|tool_call>\s*call:([\w-]+)(\{[\s\S]*?\})\s*<tool_call\|>/g

function gemmaArgs(body: string): Record<string, unknown> {
  const strings: string[] = []
  const json = body
    .replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_, s: string) => `\u0000${strings.push(s) - 1}\u0000`)
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    // oxlint-disable-next-line no-control-regex -- matches the NUL placeholders inserted above
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => JSON.stringify(strings[Number(i)]))
  return parseArgs(json)
}

function rawCalls(text: string): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = []
  const rest = text.replace(GEMMA_CALL, (_, name: string, body: string) => {
    calls.push({ id: `call_${calls.length}_${Math.random().toString(36).slice(2, 8)}`, name, args: gemmaArgs(body) })
    return ""
  })
  return { calls, rest }
}

export function fromOpenAI(res: ChatCompletion): ModelReply {
  const msg = res.choices?.[0]?.message ?? {}
  let calls: ToolCall[] = (msg.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({ id: c.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`, name: c.function!.name!, args: parseArgs(c.function!.arguments) }))
  // Some local models put their reasoning inline as <think>…</think>.
  let text = msg.content ?? ""
  let thinking = msg.reasoning ?? msg.reasoning_content ?? ""
  const inline = /<think>([\s\S]*?)(<\/think>|$)/i.exec(text)
  if (inline) {
    thinking = [thinking, inline[1]].filter(Boolean).join("\n")
    text = text.replace(inline[0], "")
  }
  const fromText = rawCalls(text)
  const fromThinking = rawCalls(thinking)
  if (!calls.length) calls = [...fromText.calls, ...fromThinking.calls]
  text = fromText.rest
  thinking = fromThinking.rest
  return {
    text: text.trim(),
    thinking: thinking.trim() || undefined,
    calls,
    usage: res.usage
      ? { input: res.usage.prompt_tokens ?? 0, output: res.usage.completion_tokens ?? 0, neurons: res.usage.neurons }
      : undefined,
  }
}
