import { useRef, useState } from "react"
import type { Draft } from "immer"
import { audioPreview, SAMPLE_SOURCES } from "@/audio/preview/AudioPreview"
import { INSTRUMENTS, instrument } from "@/audio/preview/instruments"
import { newRow, STEPS, stepSeconds } from "@/audio/preview/pattern"
import type { KnobSpec } from "@/audio/pedals"
import type { PreviewInput, SequencerRow } from "@/doc/types"
import { useEditor } from "@/state/editor"
import { ScrubNumber } from "../widgets"
import { Knob } from "./Knob"
import { usePreviewState } from "./Transport"
import { useMeters } from "./useMeters"

const VOLUME: KnobSpec = { id: "volume", label: "Volume", min: 0, max: 1, default: 0.8, scale: "linear", unit: "" }
const PAN: KnobSpec = { id: "pan", label: "Pan", min: -1, max: 1, default: 0, scale: "linear", unit: "" }

function editInput(recipe: (input: Draft<PreviewInput>) => void) {
  useEditor.getState().update((d) => {
    if (d.preview.input) recipe(d.preview.input)
  })
}

// Dragging across steps paints them all the way the first one went, like a channel rack.
let paint: boolean | null = null
if (typeof window !== "undefined") window.addEventListener("pointerup", () => (paint = null))

function ChannelRow({ row, index }: { row: SequencerRow; index: number }) {
  const label = instrument(row.instrument)?.label ?? row.instrument
  const setStep = (s: number, on: boolean) => editInput((i) => void (i.rows[index].steps[s] = on))
  return (
    <div className={`channel${row.muted ? " muted" : ""}`}>
      <button
        type="button"
        className={`channel-led${row.muted ? "" : " on"}`}
        aria-pressed={!row.muted}
        aria-label={row.muted ? `Unmute ${label}` : `Mute ${label}`}
        onClick={() => editInput((i) => void (i.rows[index].muted = !row.muted))}
      />
      <Knob compact size={26} spec={VOLUME} value={row.volume} color="var(--accent)" onChange={(v) => editInput((i) => void (i.rows[index].volume = v))} />
      <Knob compact size={26} spec={PAN} value={row.pan} color="var(--text-secondary)" onChange={(v) => editInput((i) => void (i.rows[index].pan = v))} />
      <span className="channel-name" title={label}>
        {label}
      </span>
      <div className="channel-steps" role="group" aria-label={`${label} steps`}>
        {row.steps.map((on, s) => (
          <button
            key={s}
            type="button"
            data-col={s}
            className={`step${on ? " on" : ""}${Math.floor(s / 4) % 2 ? " alt" : ""}`}
            aria-pressed={on}
            aria-label={`${label}, step ${s + 1}`}
            onPointerDown={(e) => {
              e.preventDefault()
              paint = !on
              setStep(s, paint)
            }}
            onPointerEnter={(e) => {
              if (paint !== null && e.buttons === 1 && on !== paint) setStep(s, paint)
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault()
                setStep(s, !on)
              }
            }}
          />
        ))}
      </div>
      <button type="button" className="mini-btn" aria-label={`Remove ${label}`} onClick={() => editInput((i) => void i.rows.splice(index, 1))}>
        ×
      </button>
    </div>
  )
}

function PatternTab({ input }: { input: PreviewInput }) {
  const steps = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState("")

  // The playhead: light the column being heard.
  useMeters((m) => {
    const el = steps.current
    if (!el) return
    const now = m && m.position >= 0 ? Math.floor(m.position / stepSeconds(input.bpm)) % STEPS : -1
    if (el.dataset.now === String(now)) return
    el.dataset.now = String(now)
    for (const b of el.querySelectorAll<HTMLElement>(".step")) b.classList.toggle("now", Number(b.dataset.col) === now)
  })

  const groups = [...new Set(INSTRUMENTS.map((i) => i.group))]
  return (
    <div className="pattern">
      <div className="row gap-2 pattern-bar">
        <ScrubNumber compact value={input.bpm} min={60} max={200} step={1} label="BPM" onChange={(v) => editInput((i) => void (i.bpm = Math.round(v)))} />
        <select
          className="input input-sm"
          aria-label="Add an instrument"
          value={adding}
          onChange={(e) => {
            const id = e.target.value
            setAdding("")
            if (id) editInput((i) => void i.rows.push(newRow(id) as Draft<SequencerRow>))
          }}
        >
          <option value="">+ Add instrument</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {INSTRUMENTS.filter((i) => i.group === g).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="meta small">Click or drag across the steps; each row plays its sound on the lit ones.</span>
      </div>
      <div ref={steps} className="channels">
        {input.rows.map((row, i) => (
          <ChannelRow key={row.id} row={row} index={i} />
        ))}
        {!input.rows.length && <p className="meta small">No instruments yet. Add one above, then light up the steps it should play on.</p>}
      </div>
    </div>
  )
}

function AudioTab() {
  const state = usePreviewState()
  const file = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // Picking something to listen to plays it.
  const useSample = (id: string) => {
    editInput((i) => void (i.audio = id))
    audioPreview.clearOwn()
    void audioPreview.play()
  }
  const useFile = (f: File) => {
    audioPreview.useFile(f)
    void audioPreview.play()
  }
  const useMic = () => {
    audioPreview.useMic()
    void audioPreview.play()
  }

  return (
    <div
      className={`audio-sources${dragging ? " dragging" : ""}`}
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
        if (f) useFile(f)
      }}
    >
      {SAMPLE_SOURCES.map((s) => (
        <label key={s.id} className="source-option">
          <input type="radio" name="audio-source" checked={state.source.kind === "sample" && state.source.id === s.id} onChange={() => useSample(s.id)} />
          {s.label}
        </label>
      ))}
      <label className="source-option">
        <input type="radio" name="audio-source" checked={state.source.kind === "file"} onChange={() => file.current?.click()} />
        {state.source.kind === "file" ? state.source.name : "Your own audio…"}
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => file.current?.click()}>
          Choose file
        </button>
      </label>
      <label className="source-option">
        <input type="radio" name="audio-source" checked={state.source.kind === "mic"} onChange={useMic} />
        Microphone
      </label>
      <p className="meta small">Drop an audio or video file here to play it. Your own files stay in this browser tab and aren't saved with the effect.</p>
      <input
        ref={file}
        type="file"
        accept="audio/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) useFile(f)
          e.target.value = ""
        }}
      />
    </div>
  )
}

/** What plays into the board: a 16-step pattern of instruments, or a recording. */
export function InputDrawer({ onClose }: { onClose: () => void }) {
  const input = useEditor((s) => s.doc!.preview.input)
  if (!input) return null
  const setMode = (mode: PreviewInput["mode"]) => editInput((i) => void (i.mode = mode))

  return (
    <section className="input-drawer" aria-label="Input">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={input.mode === "pattern"} onClick={() => setMode("pattern")}>
          Pattern
        </button>
        <button type="button" role="tab" className="tab" aria-selected={input.mode === "audio"} onClick={() => setMode("audio")}>
          Recording
        </button>
        <button type="button" className="mini-btn drawer-close" aria-label="Close input" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="input-body">{input.mode === "pattern" ? <PatternTab input={input} /> : <AudioTab />}</div>
    </section>
  )
}
