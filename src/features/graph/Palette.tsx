import { useMemo, useState } from "react"
import { useReactFlow } from "@xyflow/react"
import type { Kind } from "@/core/doc/types"
import { CATEGORIES, categoryColor } from "@/core/nodes/registry"
import { useEditor } from "@/state/editor"
import { DRAG_MIME } from "./GraphCanvas"
import { searchNodes } from "./QuickAdd"

// Blocks added from the palette land near the centre, scattered so repeats don't stack exactly.
const scatter = (spread: number) => Math.random() * spread

export function Palette({ kind }: { kind: Kind }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({ input: true, color: true })
  const addNode = useEditor((s) => s.addNode)
  const rf = useReactFlow()
  const defs = useMemo(() => searchNodes(kind, query), [kind, query])

  const addAtCenter = (type: string) => {
    const el = document.querySelector(".graph")!.getBoundingClientRect()
    const p = rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 })
    addNode(type, p.x - 100 + scatter(40), p.y - 40 + scatter(40))
  }

  return (
    <aside className="palette" aria-label="Blocks">
      <input
        className="input palette-search"
        placeholder="Search blocks"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="palette-scroll">
        {CATEGORIES.filter((c) => c.id !== "output").map((cat) => {
          const items = defs.filter((d) => d.category === cat.id)
          if (!items.length) return null
          const isOpen = query.trim() !== "" || open[cat.id]
          return (
            <section key={cat.id} className="palette-group">
              <button
                type="button"
                className="palette-cat"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [cat.id]: !isOpen }))}
              >
                <span className="cat-dot" style={{ background: cat.color }} />
                {cat.label}
                <span className="palette-count">{items.length}</span>
              </button>
              {isOpen && (
                <ul>
                  {items.map((d) => (
                    <li key={d.type}>
                      <button
                        type="button"
                        className="palette-item"
                        draggable
                        title={`${d.description}\nDrag onto the canvas, or click to add.`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_MIME, d.type)
                          e.dataTransfer.effectAllowed = "copy"
                        }}
                        onClick={() => addAtCenter(d.type)}
                        style={{ "--cat": categoryColor(d.category) } as React.CSSProperties}
                      >
                        <strong>
                          {d.label}
                        </strong>
                        <span>{d.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}
