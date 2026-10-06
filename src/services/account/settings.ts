import { ANTHROPIC_MODELS } from "@/core/ai/providers/anthropic"

export type Provider = "cutwire" | "anthropic" | "openai" | "custom"

export interface AiSettings {
  provider: Provider
  anthropicModel: string
  openaiModel: string
  customUrl: string
  customModel: string
  /** keep keys in localStorage instead of only for this tab */
  remember: boolean
}

const SETTINGS_KEY = "forge-ai-settings"
const keyName = (p: Provider) => `forge-ai-key-${p}`

const defaults: AiSettings = {
  provider: "cutwire",
  anthropicModel: ANTHROPIC_MODELS[0].id,
  openaiModel: "",
  customUrl: "http://localhost:11434/v1",
  customModel: "",
  remember: false,
}

export function loadSettings(): AiSettings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }
  } catch {
    return defaults
  }
}

export function saveSettings(s: AiSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  // Moving between "remember" and "this tab only" moves the keys with it.
  for (const p of ["anthropic", "openai", "custom"] as Provider[]) {
    const k = getKey(p)
    localStorage.removeItem(keyName(p))
    sessionStorage.removeItem(keyName(p))
    if (k) (s.remember ? localStorage : sessionStorage).setItem(keyName(p), k)
  }
}

/** Keys never leave the browser except in requests to the provider they belong to. */
export function getKey(p: Provider): string {
  return sessionStorage.getItem(keyName(p)) ?? localStorage.getItem(keyName(p)) ?? ""
}

export function setKey(p: Provider, key: string, remember: boolean) {
  localStorage.removeItem(keyName(p))
  sessionStorage.removeItem(keyName(p))
  if (key) (remember ? localStorage : sessionStorage).setItem(keyName(p), key)
}
