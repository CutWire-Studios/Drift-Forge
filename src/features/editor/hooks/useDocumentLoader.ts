import { useEffect, useState } from "react"
import { loadEntry } from "@/services/storage/library"
import { useEditor } from "@/state/editor"

/** Opens the library entry `id` in the editor; true if this browser doesn't have it. */
export function useDocumentLoader(id: string): boolean {
  const [missingId, setMissingId] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadEntry(id).then((e) => {
      if (!live) return
      if (e) useEditor.getState().load(e.localId, e.doc)
      else setMissingId(id)
    })
    return () => {
      live = false
    }
  }, [id])
  return missingId === id
}
