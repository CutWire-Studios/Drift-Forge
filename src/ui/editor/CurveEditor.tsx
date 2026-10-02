import { useRef, useState } from "react"
import type { CurvePoint } from "@/nodes/types"

const W = 300
const H = 160
const PAD = 10

const EASES: { value: CurvePoint["ease"]; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "linear", label: "Straight" },
  { value: "in", label: "Speed up" },
  { value: "out", label: "Slow down" },
  { value: "hold", label: "Hold (jump)" },
]

function ease(e: CurvePoint["ease"], k: number) {
  switch (e) {
    case "smooth":
      return k * k * (3 - 2 * k)
    case "in":
      return k * k * k
    case "out":
      return 1 - (1 - k) ** 3
    case "hold":
      return 0
    default:
      return k
  }
}

/**
 * Keyframes for the Keyframe curve node. X is time across the curve's length (or transition
 * progress), Y is the output between the node's bottom and top values. The ease of a point shapes
 * the segment that leaves it, matching the generated GLSL.
 */
export function CurveEditor({ points, onChange }: { points: CurvePoint[]; onChange: (p: CurvePoint[]) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [sel, setSel] = useState(0)
  const drag = useRef<number | null>(null)
  const sorted = [...points].map((p, i) => ({ ...p, i })).sort((a, b) => a.x - b.x)

  const toX = (x: number) => PAD + x * (W - 2 * PAD)
  const toY = (y: number) => H - PAD - y * (H - 2 * PAD)
  const fromEvent = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    const cx = Math.min(1, Math.max(0, (x - PAD) / (W - 2 * PAD)))
    const cy = Math.min(1, Math.max(0, (H - PAD - y) / (H - 2 * PAD)))
    return [Number(cx.toFixed(3)), Number(cy.toFixed(3))] as const
  }

  let path = ""
  if (sorted.length) {
    path = `M ${toX(0)} ${toY(sorted[0].y)} L ${toX(sorted[0].x)} ${toY(sorted[0].y)}`
    for (let s = 0; s + 1 < sorted.length; s++) {
      const a = sorted[s]
      const b = sorted[s + 1]
      for (let k = 1; k <= 24; k++) {
        const t = k / 24
        path += ` L ${toX(a.x + (b.x - a.x) * t)} ${toY(a.y + (b.y - a.y) * ease(a.ease, t))}`
      }
    }
    path += ` L ${toX(1)} ${toY(sorted[sorted.length - 1].y)}`
  }

  const cur = points[sel] ?? points[0]

  return (
    <div className="curve-editor">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="curve-svg nodrag"
        onDoubleClick={(e) => {
          const [x, y] = fromEvent(e as unknown as React.PointerEvent)
          onChange([...points, { x, y, ease: "smooth" }])
          setSel(points.length)
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const [x, y] = fromEvent(e)
          onChange(points.map((p, i) => (i === drag.current ? { ...p, x, y } : p)))
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="curve-grid">
            <line x1={toX(g)} x2={toX(g)} y1={PAD} y2={H - PAD} />
            <line x1={PAD} x2={W - PAD} y1={toY(g)} y2={toY(g)} />
          </g>
        ))}
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="curve-frame" />
        <path d={path} className="curve-line" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(p.x)}
            cy={toY(p.y)}
            r={i === sel ? 7 : 5.5}
            className={`curve-pt${i === sel ? " sel" : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.target as Element).setPointerCapture(e.pointerId)
              drag.current = i
              setSel(i)
            }}
          />
        ))}
      </svg>
      <p className="meta small">Double-click to add a point. Drag points to shape the movement.</p>
      {cur && (
        <div className="curve-controls">
          <label className="field-inline">
            <span>From this point</span>
            <select
              className="input input-sm"
              value={cur.ease}
              onChange={(e) =>
                onChange(points.map((p, i) => (i === sel ? { ...p, ease: e.target.value as CurvePoint["ease"] } : p)))
              }
            >
              {EASES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-tertiary btn-sm"
            disabled={points.length <= 1}
            onClick={() => {
              onChange(points.filter((_, i) => i !== sel))
              setSel(0)
            }}
          >
            Remove point
          </button>
        </div>
      )}
    </div>
  )
}
