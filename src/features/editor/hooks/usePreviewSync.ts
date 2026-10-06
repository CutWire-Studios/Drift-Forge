import { useEffect } from "react"
import { getEngine } from "@/services/preview/engine"
import { useEditor } from "@/state/editor"

/** While enabled, the preview engine runs and follows the document and the try-out slider values. */
export function usePreviewSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
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
  }, [enabled])
}
