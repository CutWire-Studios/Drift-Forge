import { useRef } from "react"
import { formatKnob, knobFromNorm, knobNorm, type KnobSpec } from "@/core/audio/pedals"
import { useMeters } from "./hooks/useMeters"

/** A modulation route on this knob, as the knob draws it. */
export interface KnobMod {
  mod: string
  depth: number
  color: string
  bipolar: boolean
}

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
  mods = [],
}: {
  spec: KnobSpec
  value: number
  color: string
  bound?: string
  onChange: (v: number) => void
  size?: number
  /** just the dial, with the label and value in its tooltip */
  compact?: boolean
  mods?: KnobMod[]
}) {
  const drag = useRef<{ y: number; t: number } | null>(null)
  const live = useRef<SVGCircleElement>(null)
  const t = knobNorm(spec, value)
  const c = size / 2
  const r = c - 6
  const ringR = r + 3
  const angle = START + SWEEP * t
  const tip = [c + (r - 6) * Math.cos((angle * Math.PI) / 180), c + (r - 6) * Math.sin((angle * Math.PI) / 180)]
  const nudge = (dt: number) => onChange(knobFromNorm(spec, t + dt))
  const point = (norm: number, radius: number) => {
    const a = ((START + SWEEP * Math.min(1, Math.max(0, norm))) * Math.PI) / 180
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)]
  }

  // Where the modulators have pushed the knob right now: Drift's own sum, from the preview.
  useMeters((m) => {
    const el = live.current
    if (!el) return
    let n = t
    for (const route of mods) n += route.depth * (m?.mods.get(route.mod) ?? 0)
    const [x, y] = point(n, ringR)
    el.setAttribute("cx", x.toFixed(2))
    el.setAttribute("cy", y.toFixed(2))
    el.style.opacity = m ? "1" : "0"
  })

  return (
    <div
      className={`knob${bound ? " bound" : ""}${compact ? " compact" : ""}`}
      title={knobTitle(spec, value, bound, compact)}
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
          {mods.map((m) => {
            const lo = Math.max(0, Math.min(1, m.bipolar ? t - Math.abs(m.depth) : Math.min(t, t + m.depth)))
            const hi = Math.max(0, Math.min(1, m.bipolar ? t + Math.abs(m.depth) : Math.max(t, t + m.depth)))
            return hi - lo > 0.004 ? (
              <path key={m.mod} className="knob-mod" style={{ stroke: m.color }} d={arc(c, c, ringR, START + SWEEP * lo, START + SWEEP * hi)} />
            ) : null
          })}
          <line className="knob-pointer" x1={c} y1={c} x2={tip[0]} y2={tip[1]} />
          {mods.length > 0 && <circle ref={live} className="knob-live" r={2.5} cx={c} cy={c} style={{ fill: mods[0].color, opacity: 0 }} />}
        </svg>
        {bound && <span className="param-dot knob-bound" aria-hidden="true" />}
      </div>
      {!compact && <span className="knob-label">{spec.label}</span>}
      {!compact && <span className="knob-value-text">{formatKnob(spec, value)}</span>}
    </div>
  )
}

function knobTitle(spec: KnobSpec, value: number, bound: string | undefined, compact: boolean | undefined): string | undefined {
  if (bound) return `Slider in Drift: ${bound}`
  if (compact) return `${spec.label}: ${formatKnob(spec, value)}`
  return undefined
}
