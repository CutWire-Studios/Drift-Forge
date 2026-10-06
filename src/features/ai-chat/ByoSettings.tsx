import { useState } from "react"
import { ANTHROPIC_MODELS } from "@/core/ai/providers/anthropic"
import { getKey, setKey, type AiSettings } from "@/services/account/client"
import { Toggle } from "@/shared/ui/widgets"
import { providerInfo } from "./providers"

export function ByoSettings({ settings, update }: { settings: AiSettings; update: (p: Partial<AiSettings>) => void }) {
  const p = settings.provider
  // The typed key belongs to one provider; switching provider shows that provider's stored key.
  const [typed, setTyped] = useState(() => ({ provider: p, key: getKey(p) }))
  const key = typed.provider === p ? typed.key : getKey(p)
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
            setTyped({ provider: p, key: e.target.value })
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
        Your key stays in this browser and is sent only to {providerInfo(p).keyRecipient}, never to
        Drift Forge.{settings.remember ? "" : " It's forgotten when you close this tab."}
      </p>
    </div>
  )
}
