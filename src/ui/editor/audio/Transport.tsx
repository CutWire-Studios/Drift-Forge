import { useEffect, useRef, useSyncExternalStore } from "react"
import { audioPreview, SAMPLE_SOURCES, type Playing } from "@/audio/preview/AudioPreview"
import { useMeters } from "./useMeters"

export function usePreviewState() {
  return useSyncExternalStore(
    (fn) => audioPreview.onState(fn),
    () => audioPreview.state,
  )
}

/** Input and output level, side by side, so you can see what the board does to the loudness. */
function LevelMeters() {
  const input = useRef<HTMLDivElement>(null)
  const output = useRef<HTMLDivElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  useMeters((m) => {
    const set = (el: HTMLDivElement | null, tap: Float32Array | null | undefined) => {
      const peak = tap ? Math.max(tap[0], tap[1]) : 0
      // -60..0 dBFS across the bar; red once it reaches full scale.
      const db = peak > 0 ? 20 * Math.log10(peak) : -60
      el?.style.setProperty("--level", Math.max(0, Math.min(1, (db + 60) / 60)).toFixed(3))
      el?.classList.toggle("clip", peak >= 0.999)
    }
    set(input.current, m?.input)
    set(output.current, m?.output)
    if (time.current) time.current.textContent = m && m.position >= 0 ? `${m.position.toFixed(1)} s` : ""
  })
  return (
    <div className="levels" aria-hidden="true">
      <span>In</span>
      <div ref={input} className="level" />
      <span>Out</span>
      <div ref={output} className="level" />
      <span ref={time} className="level-time" />
    </div>
  )
}

function describe(source: Playing): string {
  switch (source.kind) {
    case "pattern":
      return "Your pattern"
    case "sample":
      return SAMPLE_SOURCES.find((s) => s.id === source.id)?.label ?? "Recording"
    case "file":
      return source.name
    case "mic":
      return "Microphone"
  }
}

export function Transport({ inputOpen, onToggleInput }: { inputOpen: boolean; onToggleInput: () => void }) {
  const state = usePreviewState()

  useEffect(() => () => audioPreview.pause(), [])

  return (
    <section className="transport" aria-label="Listen">
      <div className="row gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm play-btn"
          onClick={() => (state.playing ? audioPreview.pause() : void audioPreview.play())}
          aria-label={state.playing ? "Pause" : "Play"}
        >
          {state.playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M7 4l13 8-13 8z" fill="currentColor" />
            </svg>
          )}
          {state.playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn btn-tertiary btn-sm source-btn" aria-expanded={inputOpen} onClick={onToggleInput} title="Choose what plays into the board">
          <span className="source-name">{describe(state.source)}</span>
          <span aria-hidden="true">{inputOpen ? "▾" : "▸"}</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ab-btn${state.abBypass ? " btn-secondary" : " btn-tertiary"}`}
          aria-pressed={state.abBypass}
          title="Hear the sound without your effect, to compare"
          onClick={() => audioPreview.setAbBypass(!state.abBypass)}
        >
          {state.abBypass ? "Hearing original" : "Compare"}
        </button>
      </div>
      <LevelMeters />
      {state.source.kind === "mic" && state.playing && <p className="meta small">Use headphones: the speakers would feed back into the microphone.</p>}
      {state.error && <p className="meta small danger-text">{state.error}</p>}
    </section>
  )
}
