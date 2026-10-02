import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import { useEditor } from "@/state/editor"

/** A wire with a remove button at its midpoint, shown while hovered or selected. */
export function WireEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, selected, data }: EdgeProps) {
  const [path, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const disconnect = useEditor((s) => s.disconnect)
  const show = selected || (data as { hover?: boolean } | undefined)?.hover
  return (
    <>
      <BaseEdge id={id} path={path} style={style} interactionWidth={18} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`wire-del nodrag nopan${show ? " show" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          aria-label="Remove connection"
          title="Remove connection"
          onClick={(e) => {
            e.stopPropagation()
            disconnect([id])
          }}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
