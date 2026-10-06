import { useRef, useState } from "react"
import type { GradientStop } from "@/core/doc/types"
import { rgbToHex } from "@/core/doc/util"
import { evalGradient } from "@/core/doc/lookup"
import { ColorSwatch, ScrubNumber } from "./widgets"
import "./controls.css"

export function SeedInput({ value, onChange, compact }: { value: number; onChange: (v: number) => void; compact?: boolean }) {
  return (
    <div className="seed-input nodrag">
      <ScrubNumber compact={compact} value={value} min={0} max={1000} step={1} label={compact ? "Seed" : undefined} onChange={onChange} />
      <button
        type="button"
        className="mini-btn"
        title="Shuffle"
        aria-label="Shuffle"
        onClick={(e) => {
          e.stopPropagation()
          onChange(Math.floor(Math.random() * 1000))
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 7h3c4 0 6 10 10 10h3M4 17h3c1.6 0 2.8-1.6 4-3.6M13 9.6C14.2 8 15.4 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

const css = (stops: GradientStop[]) => {
  const s = [...stops].sort((a, b) => a.pos - b.pos)
  return `linear-gradient(90deg, ${s
    .map((x) => `rgba(${x.color.slice(0, 3).map((v) => Math.round(v * 255)).join(",")},${x.color[3]}) ${x.pos * 100}%`)
    .join(", ")})`
}

/** Colour stops on a bar: drag to move, click the bar to add, pick a stop to recolour it. */
export function GradientEditor({ value, onChange }: { value: GradientStop[]; onChange: (v: GradientStop[]) => void }) {
  const bar = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState(0)
  const drag = useRef<number | null>(null)
  const pos = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect()
    return Number(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3))
  }
  const cur = value[sel] ?? value[0]
  return (
    <div className="gradient-editor nodrag">
      <div
        ref={bar}
        className="gradient-bar"
        style={{ backgroundImage: `${css(value)}, conic-gradient(#aaa 25%, #eee 0 50%, #aaa 0 75%, #eee 0)`, backgroundSize: "100% 100%, 12px 12px" }}
        onPointerDown={(e) => {
          if (e.target !== bar.current) return
          const p = pos(e)
          const c = evalGradient(value, p) as [number, number, number, number]
          onChange([...value, { pos: p, color: c }])
          setSel(value.length)
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const p = pos(e)
          onChange(value.map((s, i) => (i === drag.current ? { ...s, pos: p } : s)))
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {value.map((s, i) => (
          <span
            key={i}
            className={`gradient-stop${i === sel ? " sel" : ""}`}
            style={{ left: `${s.pos * 100}%`, background: rgbToHex(s.color) }}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId)
              drag.current = i
              setSel(i)
            }}
          />
        ))}
      </div>
      {cur && (
        <div className="row gap-2">
          <ColorSwatch value={cur.color} onChange={(c) => onChange(value.map((s, i) => (i === sel ? { ...s, color: [c[0], c[1], c[2], s.color[3]] } : s)))} />
          <ScrubNumber
            compact
            label="Opacity"
            value={cur.color[3]}
            onChange={(a) => onChange(value.map((s, i) => (i === sel ? { ...s, color: [s.color[0], s.color[1], s.color[2], a] } : s)))}
          />
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={value.length <= 2}
            onClick={() => {
              onChange(value.filter((_, i) => i !== sel))
              setSel(0)
            }}
          >
            Remove
          </button>
        </div>
      )}
      <p className="meta small">Click the bar to add a colour, drag the markers to move them.</p>
    </div>
  )
}

/** Draw a box on a frame-shaped pad; value is [x, y, w, h] in 0..1 of the frame. */
export function RegionPad({
  value,
  onChange,
  ellipse,
}: {
  value: [number, number, number, number]
  onChange: (v: [number, number, number, number]) => void
  ellipse?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const start = useRef<[number, number] | null>(null)
  const at = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }
  const round = (v: number) => Number(v.toFixed(3))
  return (
    <div className="vec2-control">
      <div
        ref={ref}
        className="point-pad region-pad nodrag"
        onPointerDown={(e) => {
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          start.current = at(e)
        }}
        onPointerMove={(e) => {
          if (!start.current) return
          const [x0, y0] = start.current
          const [x1, y1] = at(e)
          onChange([round(Math.min(x0, x1)), round(Math.min(y0, y1)), round(Math.abs(x1 - x0)), round(Math.abs(y1 - y0))])
        }}
        onPointerUp={() => (start.current = null)}
      >
        <span
          className="region-box"
          style={{
            left: `${value[0] * 100}%`,
            top: `${value[1] * 100}%`,
            width: `${value[2] * 100}%`,
            height: `${value[3] * 100}%`,
            borderRadius: ellipse ? "50%" : 4,
          }}
        />
      </div>
      <div className="point-input four">
        {(["X", "Y", "W", "H"] as const).map((l, i) => (
          <ScrubNumber key={l} compact label={l} value={value[i]} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)) as typeof value)} />
        ))}
      </div>
      <p className="meta small">Drag on the frame to draw the area.</p>
    </div>
  )
}

export function LabelsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="labels-editor">
      {value.map((l, i) => (
        <div className="row gap-2" key={i}>
          <span className="meta small label-index">{i}</span>
          <input
            className="input input-sm"
            value={l}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="mini-btn"
            aria-label="Remove choice"
            disabled={value.length <= 2}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-tertiary btn-sm" disabled={value.length >= 8} onClick={() => onChange([...value, `Choice ${value.length + 1}`])}>
        Add choice
      </button>
    </div>
  )
}
