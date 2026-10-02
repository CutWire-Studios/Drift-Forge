import type { AgentMessage, ModelReply, ToolCall } from "../agent"
import type { ToolSpec } from "../tools"

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
  usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number }
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
