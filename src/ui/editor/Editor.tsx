import { useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router"
import { ReactFlowProvider } from "@xyflow/react"
import { useStore } from "zustand"
import { getEngine } from "@/runtime/engine"
import { useEditor } from "@/state/editor"
import { loadEntry, saveEntry } from "@/storage/library"
import { Brand } from "../AppHeader"
import { ThemeToggle } from "../ThemeToggle"
import { AudioEditor } from "./AudioEditor"
import { CodePanel } from "./CodePanel"
import { ExportDialog } from "./ExportDialog"
import { GraphCanvas } from "./GraphCanvas"
import { Inspector } from "./Inspector"
import { Palette } from "./Palette"
import { PreviewPanel } from "./PreviewPanel"

function webgl2Available(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2")
  } catch {
    return false
  }
}

function typingInField(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.closest("input, textarea, select, [contenteditable], .cm-editor") !== null
}

export function TopBar({ onExport, onCode, saved }: { onExport: () => void; onCode: () => void; saved: boolean }) {
  const doc = useEditor((s) => s.doc!)
  const update = useEditor((s) => s.update)
  const { undo, redo } = useEditor.temporal.getState()
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0)

  return (
    <header className="topbar">
      <Brand />
      <span className="divider" aria-hidden="true" />
      <input
        className="doc-name"
        aria-label="Name"
        value={doc.meta.displayName}
        onChange={(e) => update((d) => void (d.meta.displayName = e.target.value))}
      />
      <span className="pill">{doc.kind === "effect" ? "Effect" : doc.kind === "audio" ? "Audio effect" : "Transition"}</span>
      <span className="meta small save-state">{saved ? "Saved in this browser" : "Saving…"}</span>
      <div className="topbar-actions">
        <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => redo()}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        {doc.kind !== "audio" && (
          <button type="button" className="btn btn-tertiary btn-sm" onClick={onCode}>
            Code
          </button>
        )}
        {doc.kind !== "audio" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onExport}>
            Export
          </button>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}

export function Editor() {
  const { id } = useParams()
  const doc = useEditor((s) => s.doc)
  const localId = useEditor((s) => s.localId)
  const [missing, setMissing] = useState(false)
  const [dialog, setDialog] = useState<"export" | "code" | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState(true)
  const quickAdd = useRef<(() => void) | null>(null)
  const [webgl] = useState(webgl2Available)
  // Audio effects have no graph and no preview, so none of the WebGL machinery applies to them.
  const isAudio = doc?.kind === "audio"

  useEffect(() => {
    let live = true
    setMissing(false)
    loadEntry(id!).then((e) => {
      if (!live) return
      if (e) useEditor.getState().load(e.localId, e.doc)
      else setMissing(true)
    })
    return () => {
      live = false
    }
  }, [id])

  // Preview engine follows the document and the try-out slider values.
  useEffect(() => {
    if (!webgl || isAudio) return
    const engine = getEngine()
    engine.start()
    const s = useEditor.getState()
    if (s.doc) engine.setDoc(s.doc)
    engine.setParamValues(s.paramValues)
    const unsub = useEditor.subscribe((st, prev) => {
      if (st.doc && st.doc !== prev.doc) engine.setDoc(st.doc)
      if (st.paramValues !== prev.paramValues) engine.setParamValues(st.paramValues)
    })
    return () => {
      unsub()
      engine.stop()
    }
  }, [webgl, isAudio])

  // Autosave shortly after edits stop.
  useEffect(() => {
    if (!doc || !localId || localId !== id) return
    setSaved(false)
    const t = setTimeout(async () => {
      await saveEntry({ localId, doc, updatedAt: Date.now(), thumb: isAudio ? undefined : getEngine().snapshot() })
      setSaved(true)
    }, 700)
    return () => clearTimeout(t)
  }, [doc, localId, id, isAudio])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e) || dialog) return
      const mod = e.ctrlKey || e.metaKey
      const { undo, redo } = useEditor.temporal.getState()
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        redo()
      } else if (isAudio) {
        return
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault()
        const s = useEditor.getState()
        s.duplicateNodes(s.selected)
      } else if (e.key === " " && !mod) {
        e.preventDefault()
        quickAdd.current?.()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dialog, isAudio])

  if (!webgl && !isAudio) {
    return (
      <main className="page empty-page">
        <h2>Your browser can't run the preview</h2>
        <p className="meta">
          Drift Forge needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.
        </p>
        <Link className="btn btn-primary" to="/">
          Back
        </Link>
      </main>
    )
  }
  if (missing) {
    return (
      <main className="page empty-page">
        <h2>This effect isn't in this browser</h2>
        <p className="meta">Effects are saved in the browser you made them in. Use a share link or a .driftfx file to move them.</p>
        <Link className="btn btn-primary" to="/">
          Back to your creations
        </Link>
      </main>
    )
  }
  if (!doc || localId !== id) return <main className="page empty-page" />

  if (doc.kind === "audio") {
    return (
      <div className="editor audio-shell">
        <TopBar onExport={() => {}} onCode={() => {}} saved={saved} />
        <AudioEditor />
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className={`editor${expanded ? " preview-expanded" : ""}`}>
        <TopBar onExport={() => setDialog("export")} onCode={() => setDialog("code")} saved={saved} />
        <Palette kind={doc.kind} />
        <GraphCanvas quickAddRef={quickAdd} />
        <div className="side">
          <PreviewPanel kind={doc.kind} expanded={expanded} onToggleExpand={() => setExpanded((x) => !x)} />
          <Inspector />
        </div>
      </div>
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} onShowCode={() => setDialog("code")} />}
      {dialog === "code" && <CodePanel onClose={() => setDialog(null)} />}
    </ReactFlowProvider>
  )
}
