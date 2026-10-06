import { useEffect, type RefObject } from "react"
import { useEditor } from "@/state/editor"

function typingInField(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  return t.closest("input, textarea, select, [contenteditable], .cm-editor") !== null
}

/** Undo/redo everywhere; duplicate and quick add only on the node graph. */
export function useShortcuts({ enabled, graph, quickAdd }: { enabled: boolean; graph: boolean; quickAdd: RefObject<(() => void) | null> }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingInField(e) || !enabled) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const { undo, redo } = useEditor.temporal.getState()
      if (mod && key === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === "y") {
        e.preventDefault()
        redo()
        return
      }
      if (!graph) return
      if (mod && key === "d") {
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
  }, [enabled, graph, quickAdd])
}
