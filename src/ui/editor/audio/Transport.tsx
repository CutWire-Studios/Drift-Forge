import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { audioPreview, SAMPLE_SOURCES, type SourceId } from "@/audio/preview/AudioPreview"
import { useMeters } from "./useMeters"

function usePreviewState() {
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

export function Transport() {
  const state = usePreviewState()
  const file = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => audioPreview.pause(), [])

  const pickSource = (id: SourceId) => {
    if (id === "file") file.current?.click()
    else void audioPreview.setSource(id)
  }

  return (
    <section
      className={`transport${dragging ? " dragging" : ""}`}
      aria-label="Listen"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) void audioPreview.setSource("file", f)
      }}
    >
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
        <select className="input input-sm source-select" aria-label="What to play" value={state.source} onChange={(e) => pickSource(e.target.value as SourceId)}>
          {SAMPLE_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value="file">{state.source === "file" ? state.sourceName : "Your audio file…"}</option>
          <option value="mic">Microphone</option>
        </select>
        <button
          type="button"
          className={`btn btn-sm ab-btn${state.abBypass ? " btn-secondary" : " btn-tertiary"}`}
          aria-pressed={state.abBypass}
          title="Hear the sound without your effect, to compare"
          onClick={() => audioPreview.setAbBypass(!state.abBypass)}
        >
          {state.abBypass ? "Hearing original" : "Compare"}
        </button>
        <input
          ref={file}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void audioPreview.setSource("file", f)
            e.target.value = ""
          }}
        />
      </div>
      <LevelMeters />
      {state.source === "mic" && state.playing && <p className="meta small">Use headphones: the speakers would feed back into the microphone.</p>}
      {state.error && <p className="meta small danger-text">{state.error}</p>}
    </section>
  )
}
