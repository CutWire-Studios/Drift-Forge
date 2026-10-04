import { useState } from "react"
import { AUDIO_PROCESSORS, audioProcessor, processorParams } from "@/audio/processors"
import { AUDIO_CATEGORIES } from "@/doc/types"
import { exportDriftfx, exportZip } from "@/export/archive"
import { download } from "@/export/images"
import { useEditor } from "@/state/editor"
import { toast } from "../toast"

/**
 * An audio effect is one of Drift's built-in processors plus the values its sliders start at, so
 * there is no graph or preview to draw: pick the processor, tune the sliders, export.
 */
export function AudioEditor() {
  const doc = useEditor((s) => s.doc!)
  const update = useEditor((s) => s.update)
  const [busy, setBusy] = useState(false)
  const processor = audioProcessor(doc.audio?.processor) ?? AUDIO_PROCESSORS[0]
  const fileBase = doc.meta.displayName.replace(/[^\w\- ]+/g, "").trim() || doc.meta.id

  const setProcessor = (id: string) => {
    const next = audioProcessor(id)
    if (!next) return
    update((d) => {
      d.audio = { processor: next.id }
      d.params = processorParams(next)
      d.meta.category = next.category
    })
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page audio-editor">
      <section className="audio-card">
        <h2>Processor</h2>
        <label className="field">
          <span>Which sound effect to use</span>
          <select className="input" value={processor.id} onChange={(e) => setProcessor(e.target.value)}>
            {AUDIO_PROCESSORS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="meta">Changing it resets the sliders below to that effect's own values.</p>
      </section>

      <section className="audio-card">
        <h2>Starting values</h2>
        <p className="meta">What each slider reads when someone adds your effect in Drift. They can still change them.</p>
        {doc.params.map((p, i) =>
          p.type === "bool" ? (
            <div className="field-inline" key={p.identifier}>
              <span>{p.displayName}</span>
              <input
                type="checkbox"
                aria-label={p.displayName}
                checked={p.default === true}
                onChange={(e) => update((d) => void (d.params[i].default = e.target.checked))}
              />
            </div>
          ) : (
            <label className="field audio-slider" key={p.identifier}>
              <span>{p.displayName}</span>
              <div className="row gap-2">
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={(p.max - p.min) / 200}
                  value={Number(p.default)}
                  onChange={(e) => update((d) => void (d.params[i].default = Number(e.target.value)))}
                />
                <input
                  className="input input-sm"
                  type="number"
                  min={p.min}
                  max={p.max}
                  step="any"
                  value={Number(Number(p.default).toFixed(3))}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) update((d) => void (d.params[i].default = Math.min(p.max, Math.max(p.min, v))))
                  }}
                />
              </div>
            </label>
          ),
        )}
      </section>

      <section className="audio-card">
        <h2>Details</h2>
        <label className="field">
          <span>Category in Drift</span>
          <select className="input" value={doc.meta.category} onChange={(e) => update((d) => void (d.meta.category = e.target.value))}>
            {AUDIO_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Description</span>
          <textarea className="input" rows={2} value={doc.meta.description} onChange={(e) => update((d) => void (d.meta.description = e.target.value))} />
        </label>
        <div className="row gap-2">
          <label className="field">
            <span>Author</span>
            <input className="input" value={doc.meta.author} onChange={(e) => update((d) => void (d.meta.author = e.target.value))} />
          </label>
          <label className="field">
            <span>Version</span>
            <input className="input" value={doc.meta.version} onChange={(e) => update((d) => void (d.meta.version = e.target.value))} />
          </label>
        </div>
      </section>

      <section className="audio-card">
        <h2>Export</h2>
        <p className="meta">Open the .driftfx in Drift's effects panel with Import. It appears under My Audio Effects.</p>
        <div className="row gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => run(async () => download(`${fileBase}.driftfx`, await exportDriftfx(doc, { png: null }), "application/octet-stream"))}
          >
            Download .driftfx
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => run(async () => download(`${fileBase}.zip`, exportZip(doc, { png: null }), "application/zip"))}
          >
            Download .zip
          </button>
        </div>
      </section>
    </main>
  )
}
