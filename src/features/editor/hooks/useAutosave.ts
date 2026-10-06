import { useEffect, useState } from "react"
import type { ForgeDoc } from "@/core/doc/types"
import { getEngine } from "@/services/preview/engine"
import { saveEntry } from "@/services/storage/library"

const AUTOSAVE_DELAY_MS = 700

/** Saves the document to this browser shortly after edits stop; true once the latest edit is saved. */
export function useAutosave(doc: ForgeDoc | null, localId: string | null, routeId: string, withThumb: boolean): boolean {
  const [savedDoc, setSavedDoc] = useState<ForgeDoc | null>(null)
  const saving = !!doc && !!localId && localId === routeId
  useEffect(() => {
    if (!doc || !localId || localId !== routeId) return
    const t = setTimeout(async () => {
      await saveEntry({ localId, doc, updatedAt: Date.now(), thumb: withThumb ? getEngine().snapshot() : undefined })
      setSavedDoc(doc)
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [doc, localId, routeId, withThumb])
  return !saving || savedDoc === doc
}
