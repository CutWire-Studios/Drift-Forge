import { useEffect, useRef, useState } from "react"
import { signOut, useAccount, type Provider } from "@/services/account/client"
import { useDoc, useEditor } from "@/state/editor"
import { ByoSettings } from "./ByoSettings"
import { ChatView } from "./ChatView"
import { McpDialog } from "./McpDialog"
import { PROVIDERS } from "./providers"
import { useAgentChat } from "./useAgentChat"
import "./ai-chat.css"

export function AiPanel() {
  const localId = useEditor((s) => s.localId)!
  const isAudio = useDoc((d) => d.kind === "audio")
  const { settings, updateSettings, lines, busy, input, setInput, send } = useAgentChat(localId)
  const [showSettings, setShowSettings] = useState(false)
  const [showMcp, setShowMcp] = useState(false)
  const account = useAccount()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!account.loaded) void account.refresh()
  }, [account])
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [lines])

  const hosted = settings.provider === "cutwire"
  const needsSignIn = hosted && account.loaded && !account.signedIn

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <select className="input input-sm" value={settings.provider} onChange={(e) => updateSettings({ provider: e.target.value as Provider })}>
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

      {hosted && <QuotaBar />}

      {!hosted && showSettings && <ByoSettings settings={settings} update={updateSettings} />}

      <div className="ai-log" ref={listRef}>
        <ChatView lines={lines} busy={busy} isAudio={isAudio} needsSignIn={needsSignIn} send={(t) => void send(t)} />
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

function QuotaBar() {
  const account = useAccount()
  if (!account.signedIn || !account.quota) return null
  const left = (account.quota.userLeft / account.quota.userLimit) * 100
  return (
    <div className="ai-quota" title="Resets at midnight UTC">
      <div className="link-meter">
        <span style={{ width: `${left}%` }} />
      </div>
      <span className="meta small">
        {Math.round(left)}% of today's free AI left · {account.name} ·{" "}
        <button type="button" className="link-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </span>
    </div>
  )
}
