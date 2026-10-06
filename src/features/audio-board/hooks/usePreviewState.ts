import { useSyncExternalStore } from "react"
import { audioPreview } from "@/services/audio-preview/AudioPreview"

/** What the preview is playing, re-rendering when that changes. */
export function usePreviewState() {
  return useSyncExternalStore(
    (fn) => audioPreview.onState(fn),
    () => audioPreview.state,
  )
}
