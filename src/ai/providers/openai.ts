import type { ModelAdapter } from "../agent"
import { fromOpenAI, readChatResponse, toOpenAIMessages, toOpenAITools } from "./openaiFormat"

export const OPENAI_URL = "https://api.openai.com/v1"

/**
 * OpenAI, or any OpenAI-compatible server (Ollama, LM Studio, vLLM…), called straight from the
 * browser with the user's own key. Nothing goes through Forge's server.
 */
export function openAIAdapter(opts: { baseUrl: string; apiKey?: string; model: string }): ModelAdapter {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`
  return {
    async complete({ system, messages, tools, onDelta }) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          messages: toOpenAIMessages(system, messages),
          tools: toOpenAITools(tools),
          tool_choice: "auto",
          stream: true,
          stream_options: { include_usage: true },
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`The AI server answered ${res.status}. ${body.slice(0, 300)}`)
      }
      return fromOpenAI(await readChatResponse(res, onDelta))
    },
  }
}
