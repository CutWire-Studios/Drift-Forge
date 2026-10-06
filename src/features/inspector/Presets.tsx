import { useState } from "react"
import { useDoc, useEditor } from "@/state/editor"

export function Presets() {
  const presets = useDoc((d) => d.presets) ?? []
  const { savePreset, applyPreset, deletePreset } = useEditor.getState()
  const [name, setName] = useState("")
  return (
    <div className="presets">
      <h4 className="section-title">Presets</h4>
      <p className="meta small">Named sets of values people can pick in Drift. Set the sliders above, then save.</p>
      {presets.map((p) => (
        <div className="row gap-2 preset-row" key={p.name}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset(p.name)}>
            {p.name}
          </button>
          <button type="button" className="mini-btn" aria-label={`Delete preset ${p.name}`} onClick={() => deletePreset(p.name)}>
            ×
          </button>
        </div>
      ))}
      <form
        className="row gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          savePreset(name.trim())
          setName("")
        }}
      >
        <input className="input input-sm preset-name" placeholder="e.g. Subtle" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!name.trim()}>
          Save preset
        </button>
      </form>
    </div>
  )
}
