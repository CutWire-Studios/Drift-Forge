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
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string | object } }[] } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
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

export function fromOpenAI(res: ChatCompletion): ModelReply {
  const msg = res.choices?.[0]?.message ?? {}
  const calls: ToolCall[] = (msg.tool_calls ?? [])
    .filter((c) => c.function?.name)
    .map((c, i) => ({ id: c.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`, name: c.function!.name!, args: parseArgs(c.function!.arguments) }))
  return {
    text: msg.content ?? "",
    calls,
    usage: res.usage ? { input: res.usage.prompt_tokens ?? 0, output: res.usage.completion_tokens ?? 0 } : undefined,
  }
}
