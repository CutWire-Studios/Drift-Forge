import { useStore } from "zustand"
import { KIND_INFO } from "@/core/doc/kinds"
import { useDoc, useEditor } from "@/state/editor"
import { Brand } from "@/shared/ui/AppHeader"
import { ThemeToggle } from "@/shared/ui/ThemeToggle"

export function TopBar({ onExport, onCode, saved }: { onExport: () => void; onCode: () => void; saved: boolean }) {
  const doc = useDoc()
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
      <span className="pill">{KIND_INFO[doc.kind].label}</span>
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
          <>
            <button type="button" className="btn btn-tertiary btn-sm" onClick={onCode}>
              Code
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onExport}>
              Export
            </button>
          </>
        )}
        <ThemeToggle />
      </div>
    </header>
  )
}
