import Anthropic from "@anthropic-ai/sdk"
import type { AgentMessage, ModelAdapter, ToolCall } from "../agent"

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
    async complete({ system, messages, tools }) {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 16000,
        system,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })),
        messages: toMessages(messages),
      })
      if (response.stop_reason === "refusal") {
        throw new Error("The model declined this request.")
      }
      const calls: ToolCall[] = []
      let text = ""
      for (const block of response.content) {
        if (block.type === "tool_use") calls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> })
        else if (block.type === "text") text += block.text
      }
      return {
        text,
        calls,
        raw: response.content,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      }
    },
  }
}
