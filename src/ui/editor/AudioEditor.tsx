import { useEffect, useState } from "react"
import { audioPreview } from "@/audio/preview/AudioPreview"
import { validateRack } from "@/audio/rack"
import { compile } from "@/compiler/compile"
import { minAppVersion } from "@/compiler/manifest"
import { AUDIO_CATEGORIES } from "@/doc/types"
import { exportDriftfx, exportZip } from "@/export/archive"
import { download } from "@/export/images"
import { useEditor } from "@/state/editor"
import { toast } from "../toast"
import { AudioPalette } from "./audio/AudioPalette"
import { Board } from "./audio/Board"
import { PedalTab } from "./audio/PedalTab"
import { Transport } from "./audio/Transport"
import { SlidersTab } from "./Inspector"

type Tab = "pedal" | "sliders" | "details"

function DetailsTab() {
  const doc = useEditor((s) => s.doc!)
  const update = useEditor((s) => s.update)
  const [busy, setBusy] = useState(false)
  const errors = validateRack(doc)
  const fileBase = doc.meta.displayName.replace(/[^\w\- ]+/g, "").trim() || doc.meta.id
  const version = minAppVersion(doc, compile(doc, { mode: "export" }))

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
    <div className="node-details">
      <label className="field">
        <span>Category in Drift</span>
        <select className="input input-sm" value={doc.meta.category} onChange={(e) => update((d) => void (d.meta.category = e.target.value))}>
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
          <input className="input input-sm" value={doc.meta.author} onChange={(e) => update((d) => void (d.meta.author = e.target.value))} />
        </label>
        <label className="field">
          <span>Version</span>
          <input className="input input-sm" value={doc.meta.version} onChange={(e) => update((d) => void (d.meta.version = e.target.value))} />
        </label>
      </div>

      <h4 className="section-title">Export</h4>
      {errors.length > 0 ? (
        <ul className="meta small danger-text">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <p className="meta small">
          Needs Drift {version} or newer. Open the .driftfx in Drift's effects panel with Import; it appears under My Audio Effects.
        </p>
      )}
      <div className="row gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || errors.length > 0}
          onClick={() => run(async () => download(`${fileBase}.driftfx`, await exportDriftfx(doc, { png: null }), "application/octet-stream"))}
        >
          Download .driftfx
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || errors.length > 0}
          onClick={() => run(async () => download(`${fileBase}.zip`, exportZip(doc, { png: null }), "application/zip"))}
        >
          Download .zip
        </button>
      </div>
    </div>
  )
}

/**
 * An audio effect is a pedalboard: Drift's compiled-in pedals in a chain, with splits for parallel
 * and frequency-band processing. The preview plays it through the same DSP Drift runs.
 */
export function AudioEditor() {
  const [tab, setTab] = useState<Tab>("pedal")
  const selected = useEditor((s) => s.selected)
  const params = useEditor((s) => s.doc!.params.length)

  useEffect(() => {
    if (selected.length) setTab("pedal")
  }, [selected])

  // The preview follows the document and the Sliders tab's try-out values.
  useEffect(() => {
    const s = useEditor.getState()
    if (s.doc) audioPreview.setDoc(s.doc)
    audioPreview.setParamValues(s.paramValues)
    return useEditor.subscribe((st, prev) => {
      if (st.doc && st.doc !== prev.doc) audioPreview.setDoc(st.doc)
      if (st.paramValues !== prev.paramValues) audioPreview.setParamValues(st.paramValues)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [contenteditable], [role=slider]")) return
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const s = useEditor.getState()
      if (s.selected[0]) {
        e.preventDefault()
        s.removeRackItem(s.selected[0])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const doc = useEditor((s) => s.doc!)

  return (
    <>
      <AudioPalette />
      <Board doc={doc} />
      <div className="side">
        <Transport />
        <section className="inspector">
          <div className="tabs" role="tablist">
            {(
              [
                ["pedal", "Pedal"],
                ["sliders", `Sliders${params ? ` (${params})` : ""}`],
                ["details", "Details & export"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="inspector-body">
            {tab === "pedal" && <PedalTab />}
            {tab === "sliders" && <SlidersTab />}
            {tab === "details" && <DetailsTab />}
          </div>
        </section>
      </div>
    </>
  )
}
