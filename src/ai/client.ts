import { create } from "zustand"
import type { ForgeDoc } from "@/doc/types"
import type { AgentEvent, ChatTurn, Pending } from "./agent"
import { ANTHROPIC_MODELS } from "./providers/anthropic"

export type Provider = "cutwire" | "anthropic" | "openai" | "custom"

export interface Quota {
  userLeft: number
  userLimit: number
  globalLeft: number
}

interface Account {
  loaded: boolean
  signedIn: boolean
  name: string
  quota: Quota | null
  refresh(): Promise<void>
}

export const useAccount = create<Account>((set) => ({
  loaded: false,
  signedIn: false,
  name: "",
  quota: null,
  refresh: async () => {
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" })
      const me = (await r.json()) as { signedIn: boolean; name?: string; quota?: Quota }
      set({ loaded: true, signedIn: me.signedIn, name: me.name ?? "", quota: me.quota ?? null })
    } catch {
      set({ loaded: true, signedIn: false, name: "", quota: null })
    }
  },
}))

export function signIn() {
  location.assign(`/auth/login?return=${encodeURIComponent(location.pathname)}`)
}

export async function signOut() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
  await useAccount.getState().refresh()
}

export class HostedError extends Error {
  constructor(
    message: string,
    readonly quota?: Quota,
  ) {
    super(message)
  }
}

export type HostedEvent =
  | AgentEvent
  | { type: "progress"; doc: ForgeDoc }
  | { type: "done"; doc: ForgeDoc; reply: string; quota: Quota; stopped?: string }
  | { type: "error"; error: string; quota?: Quota }

/**
 * The hosted AI, streamed: reasoning, tool progress and intermediate graphs arrive as they happen.
 * Pictures stay in the browser: the server only needs to know an asset exists, so their bytes are
 * blanked out on the way up and put back into every graph that comes down.
 */
export async function hostedPrompt(
  doc: ForgeDoc,
  prompt: string,
  history: ChatTurn[],
  on: { event: (e: AgentEvent) => void; doc: (d: ForgeDoc) => void },
): Promise<{ reply: string; pending?: Pending; stopped?: string }> {
  const byId = new Map(doc.assets.map((a) => [a.id, a]))
  const restore = (d: ForgeDoc): ForgeDoc => ({ ...d, assets: d.assets.map((a) => byId.get(a.id) ?? a), preview: doc.preview })
  const slim = { ...doc, assets: doc.assets.map((a) => ({ ...a, data: "" })), preview: { thumbTime: doc.preview.thumbTime } }

  const r = await fetch("/api/ai", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: slim, prompt, history }),
  })
  if (!r.ok || !r.body) {
    const body = (await r.json().catch(() => ({}))) as { error?: string; quota?: Quota }
    if (body.quota) useAccount.setState({ quota: body.quota })
    if (r.status === 401) useAccount.setState({ signedIn: false })
    throw new HostedError(body.error ?? "The AI couldn't finish that.", body.quota)
  }

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  let pending: Pending | undefined
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const e = JSON.parse(line) as HostedEvent
      if (e.type === "progress") on.doc(restore(e.doc))
      else if (e.type === "done") {
        on.doc(restore(e.doc))
        useAccount.setState({ quota: e.quota })
        return { reply: e.reply, pending, stopped: e.stopped }
      } else if (e.type === "error") {
        if (e.quota) useAccount.setState({ quota: e.quota })
        throw new HostedError(e.error, e.quota)
      } else {
        if (e.type === "pending") pending = e.pending
        on.event(e)
      }
    }
  }
  throw new HostedError("The connection to the AI was interrupted. What it built so far is kept.")
}

// ---- bring your own key -------------------------------------------------------------------

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
