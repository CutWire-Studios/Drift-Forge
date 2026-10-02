import { useEffect, useRef, useState } from "react"
import { runAgent, type ChatTurn, type ModelAdapter } from "@/ai/agent"
import {
  getKey,
  HostedError,
  hostedPrompt,
  loadSettings,
  saveSettings,
  setKey,
  signIn,
  signOut,
  useAccount,
  type AiSettings,
  type Provider,
} from "@/ai/client"
import { anthropicAdapter, ANTHROPIC_MODELS } from "@/ai/providers/anthropic"
import { OPENAI_URL, openAIAdapter } from "@/ai/providers/openai"
import type { ForgeDoc } from "@/doc/types"
import { useEditor } from "@/state/editor"
import { Modal } from "../Modal"
import { Toggle } from "./widgets"

interface Line {
  role: "user" | "assistant" | "error"
  text: string
}

/** Conversations per document, kept for this tab only. */
const chats = new Map<string, Line[]>()

const PROVIDERS: { id: Provider; label: string }[] = [
  { id: "cutwire", label: "CutWire AI (free, sign in)" },
  { id: "anthropic", label: "Anthropic (your key)" },
  { id: "openai", label: "OpenAI (your key)" },
  { id: "custom", label: "Other / local (OpenAI-compatible)" },
]

const SUGGESTIONS = [
  "Make it look like an old VHS tape with a slight wobble",
  "A dreamy glow with warm highlights",
  "A glitch that gets stronger on the beat of a pulse",
]

function adapterFor(s: AiSettings): ModelAdapter | string {
  if (s.provider === "anthropic") {
    const key = getKey("anthropic")
    return key ? anthropicAdapter({ apiKey: key, model: s.anthropicModel }) : "Add your Anthropic API key in AI settings."
  }
  if (s.provider === "openai") {
    const key = getKey("openai")
    if (!key) return "Add your OpenAI API key in AI settings."
    if (!s.openaiModel) return "Choose an OpenAI model in AI settings."
    return openAIAdapter({ baseUrl: OPENAI_URL, apiKey: key, model: s.openaiModel })
  }
  if (!s.customUrl || !s.customModel) return "Set the server URL and model in AI settings."
  return openAIAdapter({ baseUrl: s.customUrl, apiKey: getKey("custom") || undefined, model: s.customModel })
}

/** Runs `work` as a single undo step even though it may change the document many times. */
async function oneUndoStep(work: (apply: (d: ForgeDoc) => void) => Promise<void>) {
  const before = useEditor.getState().doc!
  const temporal = useEditor.temporal.getState()
  temporal.pause()
  try {
    await work((d) => useEditor.getState().replaceDoc(d))
  } finally {
    temporal.resume()
    if (useEditor.getState().doc !== before) {
      useEditor.temporal.setState((t) => ({ pastStates: [...t.pastStates, { doc: before }], futureStates: [] }))
    }
  }
}

export function AiPanel() {
  const localId = useEditor((s) => s.localId)!
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showMcp, setShowMcp] = useState(false)
  const [lines, setLines] = useState<Line[]>(() => chats.get(localId) ?? [])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const account = useAccount()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!account.loaded) void account.refresh()
  }, [account])
  useEffect(() => {
    chats.set(localId, lines)
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [lines, localId])

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  const send = async (prompt: string) => {
    prompt = prompt.trim()
    if (!prompt || busy) return
    const history: ChatTurn[] = lines.filter((l) => l.role !== "error").map((l) => ({ role: l.role as ChatTurn["role"], text: l.text }))
    setLines((ls) => [...ls, { role: "user", text: prompt }])
    setInput("")
    setBusy("Thinking…")
    try {
      let reply = ""
      await oneUndoStep(async (apply) => {
        const doc = useEditor.getState().doc!
        if (settings.provider === "cutwire") {
          const r = await hostedPrompt(doc, prompt, history)
          apply(r.doc)
          reply = r.reply
          return
        }
        const adapter = adapterFor(settings)
        if (typeof adapter === "string") throw new Error(adapter)
        const run = await runAgent({
          adapter,
          doc,
          prompt,
          history,
          maxSteps: 16,
          onStep: (d, log) => {
            apply(d)
            setBusy(`Working… ${log.length} change${log.length === 1 ? "" : "s"}`)
          },
        })
        apply(run.doc)
        reply = run.reply
      })
      setLines((ls) => [...ls, { role: "assistant", text: reply || "Done." }])
    } catch (e) {
      setLines((ls) => [...ls, { role: "error", text: e instanceof HostedError || e instanceof Error ? e.message : "Something went wrong." }])
    } finally {
      setBusy(null)
    }
  }

  const hosted = settings.provider === "cutwire"
  const needsSignIn = hosted && account.loaded && !account.signedIn

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <select className="input input-sm" value={settings.provider} onChange={(e) => update({ provider: e.target.value as Provider })}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {!hosted && (
          <button type="button" className="btn btn-tertiary btn-sm" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? "Done" : "Settings"}
          </button>
        )}
      </div>

      {hosted && account.signedIn && account.quota && (
        <div className="ai-quota" title="Resets at midnight UTC">
          <div className="link-meter">
            <span style={{ width: `${(account.quota.userLeft / account.quota.userLimit) * 100}%` }} />
          </div>
          <span className="meta small">
            {Math.round((account.quota.userLeft / account.quota.userLimit) * 100)}% of today's free AI left · {account.name} ·{" "}
            <button type="button" className="link-btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </span>
        </div>
      )}

      {!hosted && showSettings && <ByoSettings settings={settings} update={update} />}

      <div className="ai-log" ref={listRef}>
        {needsSignIn ? (
          <div className="ai-empty">
            <p>The built-in AI is free with a CutWire account (a daily allowance per person).</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={signIn}>
              Sign in with CutWire account
            </button>
            <p className="meta small">Or pick your own AI provider above.</p>
          </div>
        ) : lines.length === 0 ? (
          <div className="ai-empty">
            <p className="meta">Describe what you want and the AI builds it with blocks you can then tweak.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="ai-suggestion" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`ai-line ai-${l.role}`}>
              {l.text}
            </div>
          ))
        )}
        {busy && <div className="ai-line ai-busy">{busy}</div>}
      </div>

      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          className="input textarea"
          rows={2}
          maxLength={1500}
          placeholder={needsSignIn ? "Sign in to use the built-in AI" : "e.g. make the wipe go diagonally with a pink glowing edge"}
          disabled={needsSignIn || !!busy}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={needsSignIn || !!busy || !input.trim()}>
          Send
        </button>
      </form>
      <button type="button" className="link-btn ai-mcp-link" onClick={() => setShowMcp(true)}>
        Use Drift Forge from Claude, Cursor or another AI app
      </button>
      {showMcp && <McpDialog onClose={() => setShowMcp(false)} />}
    </div>
  )
}

function ByoSettings({ settings, update }: { settings: AiSettings; update: (p: Partial<AiSettings>) => void }) {
  const p = settings.provider
  const [key, setKeyState] = useState(() => getKey(p))
  useEffect(() => setKeyState(getKey(p)), [p])
  return (
    <div className="ai-settings">
      <label className="field">
        <span>{p === "custom" ? "API key (if the server needs one)" : "API key"}</span>
        <input
          className="input input-sm mono"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => {
            setKeyState(e.target.value)
            setKey(p, e.target.value.trim(), settings.remember)
          }}
        />
      </label>
      {p === "anthropic" && (
        <label className="field">
          <span>Model</span>
          <select className="input input-sm" value={settings.anthropicModel} onChange={(e) => update({ anthropicModel: e.target.value })}>
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {p === "openai" && (
        <label className="field">
          <span>Model</span>
          <input className="input input-sm mono" placeholder="model id" value={settings.openaiModel} onChange={(e) => update({ openaiModel: e.target.value.trim() })} />
        </label>
      )}
      {p === "custom" && (
        <>
          <label className="field">
            <span>Server URL</span>
            <input className="input input-sm mono" value={settings.customUrl} onChange={(e) => update({ customUrl: e.target.value.trim() })} />
          </label>
          <label className="field">
            <span>Model</span>
            <input className="input input-sm mono" placeholder="e.g. qwen3:14b" value={settings.customModel} onChange={(e) => update({ customModel: e.target.value.trim() })} />
          </label>
          <p className="meta small">Needs to allow requests from this site (CORS). For Ollama: OLLAMA_ORIGINS={location.origin}</p>
        </>
      )}
      <div className="field-inline">
        <span>Remember the key on this device</span>
        <Toggle value={settings.remember} onChange={(remember) => update({ remember })} />
      </div>
      <p className="meta small">
        Your key stays in this browser and is sent only to {p === "anthropic" ? "Anthropic" : p === "openai" ? "OpenAI" : "that server"}, never to
        Drift Forge.{settings.remember ? "" : " It's forgotten when you close this tab."}
      </p>
    </div>
  )
}

function McpDialog({ onClose }: { onClose: () => void }) {
  const url = `${location.origin}/mcp`
  return (
    <Modal title="Use Drift Forge from your AI app" onClose={onClose}>
      <div className="stack gap-3">
        <p className="meta">
          Drift Forge is an MCP server. Add it to Claude, Cursor or any MCP-capable app and ask it to build an effect: it returns a link that
          opens here. It runs on your app's AI, not ours, and needs no account.
        </p>
        <label className="field">
          <span>Server URL</span>
          <input className="input input-sm mono" readOnly value={url} onFocus={(e) => e.target.select()} />
        </label>
        <label className="field">
          <span>Claude Code</span>
          <input className="input input-sm mono" readOnly value={`claude mcp add --transport http drift-forge ${url}`} onFocus={(e) => e.target.select()} />
        </label>
        <label className="field">
          <span>Cursor and other apps (mcp.json)</span>
          <textarea
            className="input textarea mono"
            rows={5}
            readOnly
            value={JSON.stringify({ mcpServers: { "drift-forge": { url } } }, null, 2)}
            onFocus={(e) => e.target.select()}
          />
        </label>
      </div>
    </Modal>
  )
}
