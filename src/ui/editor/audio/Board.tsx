import { useRef, useState } from "react"
import { formatKnob, pedalColor, pedalSpec, type KnobSpec } from "@/audio/pedals"
import { valueSpec, getValue, rackOf, type ValuePath } from "@/audio/rack"
import { isParamRef, isSplit, type ForgeDoc, type Pedal, type RackItem, type SplitBlock } from "@/doc/types"
import { useEditor } from "@/state/editor"
import { toast } from "../../toast"
import { Toggle } from "../widgets"
import { Knob } from "./Knob"
import { useMeters } from "./useMeters"

export const PEDAL_MIME = "application/x-forge-pedal"
export const ITEM_MIME = "application/x-forge-rack-item"

const numeric = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : Number(v))

/** A control's current value, whether fixed or bound to a slider, and how to change it. */
export function useRackValue(path: ValuePath): { spec?: KnobSpec; value: number; bound?: string; set: (v: number) => void } {
  const doc = useEditor((s) => s.doc!)
  const paramValues = useEditor((s) => s.paramValues)
  const spec = valueSpec(rackOf(doc), path)
  const raw = getValue(rackOf(doc), path)
  if (isParamRef(raw)) {
    const p = doc.params.find((q) => q.identifier === raw.param)
    return {
      spec,
      bound: p?.displayName ?? raw.param,
      value: numeric(paramValues[raw.param] ?? p?.default ?? 0),
      // A bound control moves the slider's try-out value, exactly as the Sliders tab does.
      set: (v) => useEditor.getState().setParamValue(raw.param, p?.type === "bool" ? v >= 0.5 : v),
    }
  }
  return { spec, value: numeric(raw ?? spec?.default ?? 0), set: (v) => useEditor.getState().setRackValue(path, spec?.scale === "toggle" ? v >= 0.5 : v) }
}

function RackKnob({ path, color }: { path: ValuePath; color: string }) {
  const { spec, value, bound, set } = useRackValue(path)
  if (!spec) return null
  if (spec.scale === "toggle") {
    return (
      <label className="rack-switch" title={bound ? `Slider in Drift: ${bound}` : undefined}>
        <Toggle value={value >= 0.5} onChange={(on) => set(on ? 1 : 0)} label={spec.label} />
        <span>{spec.label}</span>
        {bound && <span className="param-dot" aria-hidden="true" />}
      </label>
    )
  }
  if (spec.scale === "choice") {
    return (
      <label className="rack-choice" title={bound ? `Slider in Drift: ${bound}` : undefined}>
        <span>
          {spec.label}
          {bound && <span className="param-dot inline" aria-hidden="true" />}
        </span>
        <select className="input input-sm" value={Math.round(value)} onChange={(e) => set(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
          {(spec.options ?? []).map((o, i) => (
            <option key={o} value={i}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return <Knob spec={spec} value={value} color={color} bound={bound} onChange={set} />
}

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

/** The patch cable after `from` (a rack item, or "input"): it brightens with the level on it. */
function Cable({ from }: { from: string }) {
  const el = useRef<HTMLDivElement>(null)
  useMeters((m) => {
    const tap = m ? (from === "input" ? m.input : m.taps.get(from)) : null
    const rms = tap ? Math.max(tap[2], tap[3]) : 0
    el.current?.style.setProperty("--level", Math.min(1, Math.sqrt(rms) * 1.6).toFixed(3))
  })
  return <div ref={el} className="cable" aria-hidden="true" />
}

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
        if (type === "split:parallel" || type === "split:bands") s.addSplit(type === "split:bands" ? "bands" : "parallel", 2, { lane, index })
        else if (type) s.addPedal(type, { lane, index })
        else if (id) {
          const err = s.moveRackItem(id, { lane, index })
          if (err) toast(err, "error")
        }
      }}
    />
  )
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
      title={bound ? `Switched by the slider ${bound}` : on ? "On: click to bypass" : "Bypassed: click to turn on"}
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
      <footer className="pedal-foot">
        <Footswitch pedal={pedal} color={color} />
        <Scope id={pedal.id} color={color} />
      </footer>
    </article>
  )
}

function SplitCard({ split, selected }: { split: SplitBlock; selected: boolean }) {
  const { select, removeRackItem, addLane } = useEditor.getState()
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
        <strong>{split.mode === "bands" ? "Band split" : split.crossfade ? "Blend" : "Parallel"}</strong>
        <span className="meta small">
          {split.mode === "bands" ? "each lane gets one frequency band" : split.crossfade ? "fades between the two lanes" : "every lane hears the input; outputs add up"}
        </span>
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
                {i === 0 ? "Lows" : i === split.lanes.length - 1 ? "Highs" : `Band ${i + 1}`}
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

export function Board({ doc }: { doc: ForgeDoc }) {
  const rack = rackOf(doc)
  const select = useEditor((s) => s.select)
  return (
    <main className="board" aria-label="Pedalboard" onPointerDown={() => select([])}>
      <div className="board-chain">
        <span className="jack">In</span>
        <Cable from="input" />
        <RackRow items={rack.chain} lane={null} />
        <span className="jack">Out</span>
      </div>
      {!rack.chain.length && (
        <div className="board-empty">
          <h2>Build your sound left to right</h2>
          <p className="meta">Click a pedal on the left, or drag it onto the board. Audio runs from In to Out through every pedal; press Play to hear it.</p>
        </div>
      )}
    </main>
  )
}
