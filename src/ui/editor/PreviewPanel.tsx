import { useCallback, useRef, useState } from "react"
import { AUDIO_SAMPLES, type AudioItem } from "@/runtime/audio"
import { useEditor } from "@/state/editor"
import type { Kind } from "@/doc/types"
import { ASPECTS, getEngine, type Aspect } from "@/runtime/engine"
import { SAMPLES, userMedia, type MediaItem } from "@/runtime/media"
import { useEngineStatus } from "./useEngine"
import { fmt } from "./widgets"

const uploads: MediaItem[] = []

export function SourcePicker({ index, label }: { index: 0 | 1 | 2; label: string }) {
  const engine = getEngine()
  const current = useEngineStatus((s) => s.sources[index]) || engine.sources()[index].id
  const file = useRef<HTMLInputElement>(null)
  const all = [...SAMPLES, ...uploads]
  const choose = (item: MediaItem) => void engine.setSource(index, item)
  return (
    <label className="source-picker">
      <span>{label}</span>
      <select
        className="input input-sm"
        value={current}
        onChange={(e) => {
          if (e.target.value === "__upload") file.current?.click()
          else choose(all.find((m) => m.id === e.target.value)!)
        }}
      >
        <optgroup label="Clips">
          {all.filter((m) => m.kind === "video").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Photos">
          {all.filter((m) => m.kind === "image").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Test patterns">
          {all.filter((m) => m.kind === "pattern").map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
        <option value="__upload">Use my own photo or video…</option>
      </select>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          const item = userMedia(f)
          uploads.push(item)
          choose(item)
        }}
      />
    </label>
  )
}

const audioUploads: AudioItem[] = []

function MusicPicker() {
  const engine = getEngine()
  const [current, setCurrent] = useState(engine.audio.item?.id ?? AUDIO_SAMPLES[0].id)
  const [audible, setAudible] = useState(engine.audio.audible)
  const file = useRef<HTMLInputElement>(null)
  const all = [...AUDIO_SAMPLES, ...audioUploads]
  const choose = async (item: AudioItem) => {
    setCurrent(item.id)
    await engine.audio.load(item)
    await engine.audio.play()
  }
  return (
    <>
      <label className="source-picker">
        <span>Music</span>
        <select
          className="input input-sm"
          value={current}
          onChange={(e) => {
            if (e.target.value === "__upload") file.current?.click()
            else void choose(all.find((a) => a.id === e.target.value)!)
          }}
        >
          {all.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="__upload">Use my own song…</option>
        </select>
        <input
          ref={file}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            const item = { id: `user-${Date.now()}`, label: f.name, url: URL.createObjectURL(f), user: true }
            audioUploads.push(item)
            void choose(item)
          }}
        />
      </label>
      <label className="source-picker narrow">
        <span>Sound</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            engine.audio.setAudible(!audible)
            setAudible(!audible)
            void engine.audio.play()
          }}
        >
          {audible ? "On" : "Off"}
        </button>
      </label>
    </>
  )
}

export function PreviewPanel({ kind, expanded, onToggleExpand }: { kind: Kind; expanded: boolean; onToggleExpand: () => void }) {
  const engine = getEngine()
  const canvasRef = useCallback((c: HTMLCanvasElement | null) => engine.setMainCanvas(c), [engine])
  const playing = useEngineStatus((s) => s.playing)
  const position = useEngineStatus((s) => s.position)
  const duration = useEngineStatus((s) => s.duration)
  const fps = useEngineStatus((s) => s.fps)
  const error = useEngineStatus((s) => s.error)
  const [aspect, setAspect] = useState<Aspect>(engine.aspect)
  const [transDur, setTransDur] = useState(engine.transitionDuration)
  const usesClip = useEditor((s) => s.doc!.params.some((p) => p.type === "clip"))
  const usesMask = useEditor((s) => s.doc!.nodes.some((n) => n.type === "clip_mask"))
  const usesAudio = useEditor((s) => s.doc!.nodes.some((n) => n.type === "audio"))

  return (
    <section className={`preview${expanded ? " expanded" : ""}`}>
      <div className="preview-stage" style={{ aspectRatio: String(ASPECTS[aspect]) }}>
        <canvas ref={canvasRef} className="preview-canvas" />
        {error && (
          <div className="preview-error" role="alert">
            <strong>Can't show this yet</strong>
            <pre>{error}</pre>
          </div>
        )}
      </div>
      <div className="preview-controls">
        <button
          type="button"
          className="icon-btn"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => engine.setPlaying(!playing)}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M7 5l12 7-12 7z" fill="currentColor" />
            </svg>
          )}
        </button>
        <input
          className="scrubber"
          type="range"
          min={0}
          max={duration}
          step={0.001}
          value={position}
          aria-label={kind === "effect" ? "Time" : "Progress"}
          onChange={(e) => {
            engine.setPlaying(false)
            engine.seek(Number(e.target.value))
          }}
        />
        <span className="preview-time">{kind === "effect" ? `${fmt(position)}s` : `${Math.round(position * 100)}%`}</span>
        <button type="button" className="icon-btn" aria-label={expanded ? "Shrink preview" : "Enlarge preview"} onClick={onToggleExpand}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            {expanded ? (
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="2" fill="none" />
            ) : (
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="2" fill="none" />
            )}
          </svg>
        </button>
      </div>
      <div className="preview-sources">
        <SourcePicker index={0} label={kind === "effect" ? "Preview on" : "From"} />
        {kind === "transition" && <SourcePicker index={1} label="To" />}
        {(usesClip || usesMask) && <SourcePicker index={2} label={usesClip ? "Other clip" : "Clip mask"} />}
        {usesAudio && <MusicPicker />}
        <label className="source-picker narrow">
          <span>Shape</span>
          <select
            className="input input-sm"
            value={aspect}
            onChange={(e) => {
              const a = e.target.value as Aspect
              engine.aspect = a
              setAspect(a)
            }}
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
          </select>
        </label>
        {kind === "transition" && (
          <label className="source-picker narrow">
            <span>Length</span>
            <select
              className="input input-sm"
              value={transDur}
              onChange={(e) => {
                engine.transitionDuration = Number(e.target.value)
                setTransDur(engine.transitionDuration)
              }}
            >
              {[0.5, 1, 1.5, 2, 3].map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="meta small fps">{fps} fps</span>
      </div>
    </section>
  )
}
