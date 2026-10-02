import { useRef, useState } from "react"
import type { Rgba } from "@/doc/types"
import { hexToRgb, rgbToHex } from "@/doc/util"

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "0"
  const a = Math.abs(v)
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3
  return String(Number(v.toFixed(d)))
}

/**
 * A slider you can drag anywhere on (like Blender's number fields): the fill shows where the
 * value sits in its range, click without dragging to type an exact number.
 */
export function ScrubNumber({
  value,
  min = 0,
  max = 1,
  step,
  label,
  onChange,
  compact,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  label?: string
  onChange: (v: number) => void
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const drag = useRef<{ x: number; v: number; moved: boolean; w: number } | null>(null)
  const span = max - min || 1
  const fill = Math.min(1, Math.max(0, (value - min) / span))
  const snap = (v: number) => (step ? Math.round(v / step) * step : v)

  if (editing) {
    return (
      <input
        className={`scrub scrub-edit nodrag${compact ? " scrub-compact" : ""}`}
        autoFocus
        defaultValue={fmt(value)}
        onBlur={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") setEditing(false)
          e.stopPropagation()
        }}
      />
    )
  }

  return (
    <div
      className={`scrub nodrag${compact ? " scrub-compact" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        e.stopPropagation()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, v: value, moved: false, w: e.currentTarget.getBoundingClientRect().width }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 3) return
        d.moved = true
        const rate = (span / d.w) * (e.shiftKey ? 0.1 : 1)
        onChange(snap(Math.min(max, Math.max(min, d.v + dx * rate))))
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) setEditing(true)
        drag.current = null
      }}
      onKeyDown={(e) => {
        const k = (step ?? span / 100) * (e.shiftKey ? 10 : 1)
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(max, value + k))
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(min, value - k))
        else if (e.key === "Enter") setEditing(true)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <span className="scrub-fill" style={{ width: `${fill * 100}%` }} />
      {label && <span className="scrub-label">{label}</span>}
      <span className="scrub-value">{fmt(value)}</span>
    </div>
  )
}

export function ColorSwatch({
  value,
  onChange,
  label,
}: {
  value: Rgba | string
  onChange: (rgba: Rgba, hex: string) => void
  label?: string
}) {
  const hex = typeof value === "string" ? value : rgbToHex(value)
  return (
    <label className="swatch nodrag" title={label ?? hex}>
      <span className="swatch-chip" style={{ background: hex }} />
      <span className="swatch-hex">{hex}</span>
      <input
        type="color"
        value={hex}
        aria-label={label}
        onChange={(e) => {
          const [r, g, b] = hexToRgb(e.target.value)
          onChange([r, g, b, 1], e.target.value)
        }}
      />
    </label>
  )
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      className={`toggle nodrag${value ? " on" : ""}`}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!value)
      }}
    >
      <span />
    </button>
  )
}

export function PointInput({
  value,
  min = 0,
  max = 1,
  onChange,
}: {
  value: [number, number]
  min?: number
  max?: number
  onChange: (v: [number, number]) => void
}) {
  return (
    <div className="point-input">
      <ScrubNumber compact label="X" value={value[0]} min={min} max={max} onChange={(x) => onChange([x, value[1]])} />
      <ScrubNumber compact label="Y" value={value[1]} min={min} max={max} onChange={(y) => onChange([value[0], y])} />
    </div>
  )
}

/** A draggable dot over a frame-shaped pad, for positions on screen. */
export function PointPad({ value, onChange }: { value: [number, number]; onChange: (v: [number, number]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onChange([Number(x.toFixed(3)), Number(y.toFixed(3))])
  }
  return (
    <div
      ref={ref}
      className="point-pad nodrag"
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        set(e)
      }}
      onPointerMove={(e) => e.buttons && set(e)}
    >
      <span className="point-dot" style={{ left: `${value[0] * 100}%`, top: `${value[1] * 100}%` }} />
    </div>
  )
}
