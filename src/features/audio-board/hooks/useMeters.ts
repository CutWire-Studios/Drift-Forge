import { useEffect, useLayoutEffect, useRef } from "react"
import { audioPreview, type Meters } from "@/services/audio-preview/AudioPreview"

/**
 * Calls `draw` with the latest meters, at most once per animation frame, without re-rendering:
 * meters arrive ~30 times a second and only canvases and CSS variables consume them.
 */
export function useMeters(draw: (m: Meters | null) => void): void {
  const latest = useRef<Meters | null>(null)
  const drawRef = useRef(draw)
  useLayoutEffect(() => {
    drawRef.current = draw
  })
  useEffect(() => {
    let frame = 0
    const off = audioPreview.onMeters((m) => {
      latest.current = m
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          drawRef.current(latest.current)
        })
      }
    })
    const offState = audioPreview.onState(() => {
      if (!audioPreview.state.playing) drawRef.current(null)
    })
    return () => {
      off()
      offState()
      cancelAnimationFrame(frame)
    }
  }, [])
}
