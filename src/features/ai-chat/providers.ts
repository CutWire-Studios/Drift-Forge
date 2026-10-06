import type { ModelAdapter } from "@/core/ai/agent"
import { anthropicAdapter } from "@/core/ai/providers/anthropic"
import { OPENAI_URL, openAIAdapter } from "@/core/ai/providers/openai"
import { getKey, type AiSettings, type Provider } from "@/services/account/client"

export interface ProviderInfo {
  id: Provider
  label: string
  /** who a key typed in for this provider is sent to */
  keyRecipient: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "cutwire", label: "CutWire AI (free, sign in)", keyRecipient: "that server" },
  { id: "anthropic", label: "Anthropic (your key)", keyRecipient: "Anthropic" },
  { id: "openai", label: "OpenAI (your key)", keyRecipient: "OpenAI" },
  { id: "custom", label: "Other / local (OpenAI-compatible)", keyRecipient: "that server" },
]

export const providerInfo = (id: Provider): ProviderInfo => PROVIDERS.find((p) => p.id === id)!

/** The model to run for your own key, or what's missing in settings. */
const ADAPTERS: Record<Exclude<Provider, "cutwire">, (s: AiSettings) => ModelAdapter | string> = {
  anthropic: (s) => {
    const key = getKey("anthropic")
    return key ? anthropicAdapter({ apiKey: key, model: s.anthropicModel }) : "Add your Anthropic API key in AI settings."
  },
  openai: (s) => {
    const key = getKey("openai")
    if (!key) return "Add your OpenAI API key in AI settings."
    if (!s.openaiModel) return "Choose an OpenAI model in AI settings."
    return openAIAdapter({ baseUrl: OPENAI_URL, apiKey: key, model: s.openaiModel })
  },
  custom: (s) => {
    if (!s.customUrl || !s.customModel) return "Set the server URL and model in AI settings."
    return openAIAdapter({ baseUrl: s.customUrl, apiKey: getKey("custom") || undefined, model: s.customModel })
  },
}

export function adapterFor(s: Omit<AiSettings, "provider"> & { provider: Exclude<Provider, "cutwire"> }): ModelAdapter | string {
  return ADAPTERS[s.provider](s)
}
