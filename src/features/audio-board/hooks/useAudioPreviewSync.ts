import { useEffect } from "react"
import { audioPreview } from "@/services/audio-preview/AudioPreview"
import { defaultInput } from "@/services/audio-preview/pattern"
import { useEditor } from "@/state/editor"

/** Documents from before the sequencer get its default pattern, without an undo step. */
function ensurePreviewInput() {
  if (useEditor.getState().doc?.preview.input) return
  const { pause, resume } = useEditor.temporal.getState()
  pause()
  useEditor.getState().update((d) => void (d.preview.input = defaultInput()))
  resume()
}

/** Keeps the preview following the document and the Sliders tab's try-out values. */
export function useAudioPreviewSync() {
  useEffect(() => {
    ensurePreviewInput()
    const s = useEditor.getState()
    if (s.doc) audioPreview.setDoc(s.doc)
    audioPreview.setParamValues(s.paramValues)
    return useEditor.subscribe((st, prev) => {
      if (st.doc && st.doc !== prev.doc) audioPreview.setDoc(st.doc)
      if (st.paramValues !== prev.paramValues) audioPreview.setParamValues(st.paramValues)
    })
  }, [])
}
