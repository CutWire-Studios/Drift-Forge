import { useRef, useState } from "react"
import { formatKnob, pedalColor, pedalSpec } from "@/core/audio/pedals"
import { rackOf } from "@/core/audio/rack"
import { isSplit, type ForgeDoc, type Pedal, type RackItem, type SplitBlock } from "@/core/doc/types"
import type { Meters } from "@/services/audio-preview/AudioPreview"
import { useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"
import { ITEM_MIME, PEDAL_MIME } from "./dnd"
import { useMeters } from "./hooks/useMeters"
import { IrPicker } from "./IrPicker"
import { ModulatorStrip } from "./Modulators"
import { RackKnob, useRackValue } from "./RackKnob"
import "./audio-board.css"

/** The signal leaving a pedal: a few seconds of its loudest moments, plus a level bar. */
function Scope({ id, color }: { id: string; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useMeters((m) => {
    const el = canvas.current
    const ctx = el?.getContext("2d")
    if (!el || !ctx) return
    const w = el.width
    const h = el.height
    ctx.clearRect(0, 0, w, h)
    const tap = m?.taps.get(id)
    if (!tap) return
    const points = tap.length - 4
    const bar = w / points
    ctx.fillStyle = color
    for (let i = 0; i < points; i++) {
      const v = Math.min(1, Math.abs(tap[4 + i]))
      const bh = Math.max(1, v * (h - 2))
      ctx.globalAlpha = 0.35 + 0.65 * (i / points)
      ctx.fillRect(i * bar, (h - bh) / 2, Math.max(1, bar - 1), bh)
    }
    ctx.globalAlpha = 1
  })
  return <canvas ref={canvas} className="pedal-scope" width={192} height={28} aria-hidden="true" />
}

function tapAfter(m: Meters | null, from: string): Float32Array | null | undefined {
  if (!m) return null
  return from === "input" ? m.input : m.taps.get(from)
}

/** The patch cable after `from` (a rack item, or "input"): it brightens with the level on it. */
function Cable({ from }: { from: string }) {
  const el = useRef<HTMLDivElement>(null)
  useMeters((m) => {
    const tap = tapAfter(m, from)
    const rms = tap ? Math.max(tap[2], tap[3]) : 0
    el.current?.style.setProperty("--level", Math.min(1, Math.sqrt(rms) * 1.6).toFixed(3))
  })
  return <div ref={el} className="cable" aria-hidden="true" />
}

/** What the palette's split entries carry instead of a pedal type. */
const SPLIT_DRAGS: Record<string, SplitBlock["mode"]> = { "split:parallel": "parallel", "split:bands": "bands" }

function DropZone({ lane, index }: { lane: string | null; index: number }) {
  const [over, setOver] = useState(false)
  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(PEDAL_MIME) || e.dataTransfer.types.includes(ITEM_MIME)
  return (
    <div
      className={`drop-zone${over ? " over" : ""}`}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const s = useEditor.getState()
        const type = e.dataTransfer.getData(PEDAL_MIME)
        const id = e.dataTransfer.getData(ITEM_MIME)
        const splitMode = SPLIT_DRAGS[type]
        if (splitMode) s.addSplit(splitMode, 2, { lane, index })
        else if (type) s.addPedal(type, { lane, index })
        else if (id) {
          const err = s.moveRackItem(id, { lane, index })
          if (err) toast(err, "error")
        }
      }}
    />
  )
}

function footswitchTitle(on: boolean, bound?: string): string {
  if (bound) return `Switched by the slider ${bound}`
  return on ? "On: click to bypass" : "Bypassed: click to turn on"
}

function Footswitch({ pedal, color }: { pedal: Pedal; color: string }) {
  const { value, bound, set } = useRackValue({ kind: "bypass", item: pedal.id })
  const on = value < 0.5
  return (
    <button
      type="button"
      className={`footswitch${on ? " on" : ""}`}
      style={{ "--knob": color } as React.CSSProperties}
      aria-pressed={on}
      aria-label={on ? "Bypass this pedal" : "Turn this pedal on"}
      title={footswitchTitle(on, bound)}
      onClick={(e) => {
        e.stopPropagation()
        set(on ? 1 : 0)
      }}
    >
      <span className="led" />
    </button>
  )
}

function PedalCard({ pedal, selected }: { pedal: Pedal; selected: boolean }) {
  const spec = pedalSpec(pedal.type)
  const color = pedalColor(spec)
  const { select, removeRackItem } = useEditor.getState()
  return (
    <article
      className={`pedal${selected ? " selected" : ""}`}
      style={{ "--cat": color } as React.CSSProperties}
      onPointerDown={(e) => (e.stopPropagation(), select([pedal.id]))}
      aria-label={spec?.label ?? pedal.type}
    >
      <header
        className="pedal-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(ITEM_MIME, pedal.id)
          e.dataTransfer.effectAllowed = "move"
        }}
        title="Drag to move"
      >
        <strong>{spec?.label ?? pedal.type}</strong>
        <button type="button" className="mini-btn" aria-label="Remove pedal" onClick={() => removeRackItem(pedal.id)}>
          ×
        </button>
      </header>
      {spec ? (
        <div className="pedal-knobs">
          {spec.knobs.map((k) => (
            <RackKnob key={k.id} path={{ kind: "knob", item: pedal.id, knob: k.id }} color={color} />
          ))}
        </div>
      ) : (
        <p className="meta small">Drift doesn't have this pedal.</p>
      )}
      {spec?.capabilities.impulseResponse && <IrPicker pedal={pedal} />}
      <footer className="pedal-foot">
        <Footswitch pedal={pedal} color={color} />
        <Scope id={pedal.id} color={color} />
      </footer>
    </article>
  )
}

/** What a split's header calls it, and says it does. */
const SPLIT_LOOKS = {
  bands: { title: "Band split", blurb: "each lane gets one frequency band" },
  blend: { title: "Blend", blurb: "fades between the two lanes" },
  parallel: { title: "Parallel", blurb: "every lane hears the input; outputs add up" },
}

function splitLook(split: SplitBlock) {
  if (split.mode === "bands") return SPLIT_LOOKS.bands
  return split.crossfade ? SPLIT_LOOKS.blend : SPLIT_LOOKS.parallel
}

function bandName(index: number, lanes: number): string {
  if (index === 0) return "Lows"
  if (index === lanes - 1) return "Highs"
  return `Band ${index + 1}`
}

function SplitCard({ split, selected }: { split: SplitBlock; selected: boolean }) {
  const { select, removeRackItem, addLane } = useEditor.getState()
  const look = splitLook(split)
  return (
    <section className={`split${selected ? " selected" : ""}`} onPointerDown={(e) => (e.stopPropagation(), select([split.id]))} aria-label="Split">
      <header
        className="split-head"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(ITEM_MIME, split.id)
          e.dataTransfer.effectAllowed = "move"
        }}
        title="Drag to move"
      >
        <strong>{look.title}</strong>
        <span className="meta small">{look.blurb}</span>
        {split.crossfade && <RackKnob path={{ kind: "blend", item: split.id }} color="var(--accent)" />}
        <button
          type="button"
          className="mini-btn"
          aria-label="Add a lane"
          title="Add a lane"
          onClick={() => {
            const err = addLane(split.id)
            if (err) toast(err, "error")
          }}
        >
          +
        </button>
        <button type="button" className="mini-btn" aria-label="Remove split" onClick={() => removeRackItem(split.id)}>
          ×
        </button>
      </header>
      <div className="split-lanes">
        {split.lanes.map((lane, i) => (
          <div className="split-lane" key={lane.id}>
            {split.mode === "bands" && (
              <span className="lane-band">
                {bandName(i, split.lanes.length)}
                {i < split.lanes.length - 1 && <BandEdge split={split} index={i} />}
              </span>
            )}
            <RackRow items={lane.chain} lane={lane.id} />
          </div>
        ))}
      </div>
      <Scope id={split.id} color="var(--text-tertiary)" />
    </section>
  )
}

function BandEdge({ split, index }: { split: SplitBlock; index: number }) {
  const { spec, value } = useRackValue({ kind: "crossover", item: split.id, index })
  return spec ? <span className="meta small"> up to {formatKnob(spec, value)}</span> : null
}

export function RackRow({ items, lane }: { items: RackItem[]; lane: string | null }) {
  const selected = useEditor((s) => s.selected[0])
  return (
    <div className={`rack-row${lane ? " in-lane" : ""}`}>
      {items.map((item, index) => (
        <div className="rack-slot" key={item.id}>
          <DropZone lane={lane} index={index} />
          {isSplit(item) ? <SplitCard split={item} selected={selected === item.id} /> : <PedalCard pedal={item} selected={selected === item.id} />}
          <Cable from={item.id} />
        </div>
      ))}
      <DropZone lane={lane} index={items.length} />
      {lane && !items.length && <span className="lane-empty meta small">Drop a pedal here, or leave the lane dry</span>}
    </div>
  )
}

export function Board({ doc, inputOpen, onToggleInput }: { doc: ForgeDoc; inputOpen: boolean; onToggleInput: () => void }) {
  const rack = rackOf(doc)
  const select = useEditor((s) => s.select)
  return (
    <main className="board" aria-label="Pedalboard" onPointerDown={() => select([])}>
      <div className="board-chain">
        <button
          type="button"
          className={`jack jack-in${inputOpen ? " open" : ""}`}
          aria-expanded={inputOpen}
          title="What plays into the board"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onToggleInput}
        >
          In
        </button>
        <Cable from="input" />
        <RackRow items={rack.chain} lane={null} />
        <span className="jack">Out</span>
      </div>
      <ModulatorStrip rack={rack} />
      {!rack.chain.length && (
        <div className="board-empty">
          <h2>Build your sound left to right</h2>
          <p className="meta">Click a pedal on the left, or drag it onto the board. Audio runs from In to Out through every pedal; press Play to hear it.</p>
        </div>
      )}
    </main>
  )
}
