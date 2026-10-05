import { useRef } from "react"
import { formatKnob, knobFromNorm, knobNorm, type KnobSpec } from "@/audio/pedals"

const SWEEP = 270
const START = 135

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)]
  const [x1, y1] = p(from)
  const [x2, y2] = p(to)
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`
}

/**
 * A rotary control. Drag up or down (Shift for fine), use the arrow keys, or double-click to go back
 * to the pedal's default. A knob bound to a slider shows the diamond and moves the slider's
 * try-out value instead of the pedal's.
 */
export function Knob({
  spec,
  value,
  color,
  bound,
  onChange,
  size = 44,
  compact = false,
}: {
  spec: KnobSpec
  value: number
  color: string
  bound?: string
  onChange: (v: number) => void
  size?: number
  /** just the dial, with the label and value in its tooltip */
  compact?: boolean
}) {
  const drag = useRef<{ y: number; t: number } | null>(null)
  const t = knobNorm(spec, value)
  const c = size / 2
  const r = c - 4
  const angle = START + SWEEP * t
  const tip = [c + (r - 6) * Math.cos((angle * Math.PI) / 180), c + (r - 6) * Math.sin((angle * Math.PI) / 180)]
  const nudge = (dt: number) => onChange(knobFromNorm(spec, t + dt))

  return (
    <div
      className={`knob${bound ? " bound" : ""}${compact ? " compact" : ""}`}
      title={bound ? `Slider in Drift: ${bound}` : compact ? `${spec.label}: ${formatKnob(spec, value)}` : undefined}
    >
      <div
        className="knob-dial"
        role="slider"
        tabIndex={0}
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={formatKnob(spec, value)}
        style={{ "--knob": color } as React.CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { y: e.clientY, t }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const travel = e.shiftKey ? 800 : 160
          onChange(knobFromNorm(spec, drag.current.t + (drag.current.y - e.clientY) / travel))
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(spec.default)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01
          if (e.key === "ArrowUp" || e.key === "ArrowRight") nudge(step)
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") nudge(-step)
          else return
          e.preventDefault()
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <path className="knob-track" d={arc(c, c, r, START, START + SWEEP)} />
          {t > 0.002 && <path className="knob-value" d={arc(c, c, r, START, angle)} />}
          <line className="knob-pointer" x1={c} y1={c} x2={tip[0]} y2={tip[1]} />
        </svg>
        {bound && <span className="param-dot knob-bound" aria-hidden="true" />}
      </div>
      {!compact && <span className="knob-label">{spec.label}</span>}
      {!compact && <span className="knob-value-text">{formatKnob(spec, value)}</span>}
    </div>
  )
}
