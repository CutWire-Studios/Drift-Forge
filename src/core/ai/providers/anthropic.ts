import Anthropic from "@anthropic-ai/sdk"
import type { AgentMessage, ModelAdapter, ToolCall } from "@/core/ai/agent"

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest)" },
]

function toMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.text })
    else if (m.role === "assistant") {
      // Echo the model's own content back unchanged: it carries thinking blocks that must be
      // returned as-is on the next turn.
      out.push({ role: "assistant", content: (m.raw as Anthropic.ContentBlockParam[] | undefined) ?? m.text })
    } else {
      // All results of one assistant turn go back in a single user message.
      out.push({
        role: "user",
        content: m.results.map(
          (r): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: r.id, content: r.content, is_error: r.error }),
        ),
      })
    }
  }
  return out
}

/** Anthropic's API from the browser with the user's own key (never sent to Forge's server). */
export function anthropicAdapter(opts: { apiKey: string; model: string }): ModelAdapter {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true })
  return {
    async complete({ system, messages, tools, onDelta }) {
      const stream = client.messages.stream({
        model: opts.model,
        max_tokens: 16000,
        // Summarised reasoning to show in the panel. Haiku 4.5 predates adaptive thinking and
        // still takes a token budget (and returns its thinking text as-is).
        thinking: opts.model.startsWith("claude-haiku-4-5")
          ? { type: "enabled", budget_tokens: 4000 }
          : { type: "adaptive", display: "summarized" },
        system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
        messages: toMessages(messages),
      })
      if (onDelta) {
        stream.on("thinking", (text) => onDelta({ channel: "thinking", text }))
        stream.on("text", (text) => onDelta({ channel: "text", text }))
      }
      const response = await stream.finalMessage()
      if (response.stop_reason === "refusal") {
        throw new Error("The model declined this request.")
      }
      const calls: ToolCall[] = []
      let text = ""
      let thinking = ""
      for (const block of response.content) {
        if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> })
        else if (block.type === "text") text += block.text
        else if (block.type === "thinking") thinking += block.thinking
      }
      return {
        text,
        thinking: thinking.trim() || undefined,
        calls,
        raw: response.content,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      }
    },
  }
}
