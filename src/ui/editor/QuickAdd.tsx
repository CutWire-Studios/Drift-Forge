import { useEffect, useMemo, useRef, useState } from "react"
import type { Kind, SocketType } from "@/doc/types"
import { availableFor, CATEGORIES, categoryColor, NODE_DEFS } from "@/nodes/registry"
import type { NodeDef } from "@/nodes/types"

export interface PendingWire {
  node: string
  handle: string
  /** "source": dragged out of an output, so the new node needs a matching input. */
  from: "source" | "target"
  type: SocketType
}

export function searchNodes(kind: Kind, query: string, wire?: PendingWire | null): NodeDef[] {
  const q = query.trim().toLowerCase()
  const catLabel = (d: NodeDef) => CATEGORIES.find((c) => c.id === d.category)?.label.toLowerCase() ?? ""
  return NODE_DEFS.filter((d) => !d.output && availableFor(d, kind))
    .filter((d) => (wire?.from === "source" ? d.inputs.length > 0 : wire?.from === "target" ? d.outputs.length > 0 : true))
    .map((d) => {
      const label = d.label.toLowerCase()
      let score = 0
      if (!q) score = 1
      else if (label.startsWith(q)) score = 4
      else if (label.includes(q)) score = 3
      else if (catLabel(d).includes(q)) score = 2
      else if (d.description.toLowerCase().includes(q)) score = 1
      if (score && wire) {
        const socks = wire.from === "source" ? d.inputs : d.outputs
        if (socks.some((s) => s.type === wire.type)) score += 0.5
      }
      return { d, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.d)
}

export function QuickAdd({
  x,
  y,
  kind,
  wire,
  onPick,
  onClose,
}: {
  x: number
  y: number
  kind: Kind
  wire: PendingWire | null
  onPick: (type: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchNodes(kind, query, wire), [kind, query, wire])
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  return (
    <>
      <div className="quick-scrim" onPointerDown={onClose} />
      <div
        className="quick-add"
        style={{ left: Math.min(x, innerWidth - 340), top: Math.min(y, innerHeight - 380) }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1))
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0))
          else if (e.key === "Enter" && results[active]) onPick(results[active].type)
          else if (e.key === "Escape") onClose()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <input
          className="input quick-input"
          autoFocus
          placeholder="Search blocks: blur, wipe, glow…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
        />
        <ul ref={listRef} className="quick-list" role="listbox">
          {results.map((d, i) => (
            <li
              key={d.type}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onPointerEnter={() => setActive(i)}
              onClick={() => onPick(d.type)}
            >
              <span className="cat-dot" style={{ background: categoryColor(d.category) }} />
              <span className="quick-text">
                <strong>{d.label}</strong>
                <span>{d.description}</span>
              </span>
            </li>
          ))}
          {results.length === 0 && <li className="quick-empty">No blocks match “{query}”.</li>}
        </ul>
      </div>
    </>
  )
}
