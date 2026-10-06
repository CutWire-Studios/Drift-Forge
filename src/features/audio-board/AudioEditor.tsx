import { useEffect, useState } from "react"
import { validateRack } from "@/core/audio/rack"
import { compile } from "@/core/compiler/compile"
import { minAppVersion } from "@/core/compiler/manifest"
import { KIND_INFO } from "@/core/doc/kinds"
import { errorMessage } from "@/core/errors"
import { exportDriftfx, exportZip } from "@/core/export/archive"
import { loadIrFiles } from "@/services/audio-preview/irLoader"
import { download } from "@/services/storage/assets"
import { useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"
import { AiPanel } from "@/features/ai-chat"
import { SlidersTab } from "@/features/inspector"
import { AudioPalette } from "./AudioPalette"
import { Board } from "./Board"
import { useAudioPreviewSync } from "./hooks/useAudioPreviewSync"
import { InputDrawer } from "./InputDrawer"
import { PedalTab } from "./PedalTab"
import { Transport } from "./Transport"

type Tab = "pedal" | "sliders" | "details" | "ai"

function DetailsTab() {
  const doc = useDoc()
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
      toast(errorMessage(e), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="node-details">
      <label className="field">
        <span>Category in Drift</span>
        <select className="input input-sm" value={doc.meta.category} onChange={(e) => update((d) => void (d.meta.category = e.target.value))}>
          {KIND_INFO.audio.categories.map((c) => (
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
          onClick={() => run(async () => download(`${fileBase}.driftfx`, await exportDriftfx(doc, { png: null, irs: await loadIrFiles(doc) }), "application/octet-stream"))}
        >
          Download .driftfx
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || errors.length > 0}
          onClick={() => run(async () => download(`${fileBase}.zip`, exportZip(doc, { png: null, irs: await loadIrFiles(doc) }), "application/zip"))}
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
  const [inputOpen, setInputOpen] = useState(true)
  const selected = useEditor((s) => s.selected)
  const params = useDoc((d) => d.params.length)

  // Selecting something shows its pedal, unless the AI chat is open.
  const [seenSelection, setSeenSelection] = useState(selected)
  if (seenSelection !== selected) {
    setSeenSelection(selected)
    if (selected.length && tab !== "ai") setTab("pedal")
  }

  useAudioPreviewSync()

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

  const doc = useDoc()

  return (
    <>
      <AudioPalette />
      <div className="board-area">
        <Board doc={doc} inputOpen={inputOpen} onToggleInput={() => setInputOpen((o) => !o)} />
        {inputOpen && <InputDrawer onClose={() => setInputOpen(false)} />}
      </div>
      <div className="side">
        <Transport inputOpen={inputOpen} onToggleInput={() => setInputOpen((o) => !o)} />
        <section className="inspector">
          <div className="tabs" role="tablist">
            {(
              [
                ["pedal", "Selected"],
                ["sliders", `Sliders${params ? ` (${params})` : ""}`],
                ["details", "Details & export"],
                ["ai", "AI"],
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
            {tab === "ai" && <AiPanel />}
          </div>
        </section>
      </div>
    </>
  )
}
