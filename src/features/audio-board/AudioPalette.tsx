import { useMemo, useState } from "react"
import { PEDAL_GROUPS, PEDALS, pedalColor, type PedalSpec } from "@/core/audio/pedals"
import { useEditor } from "@/state/editor"
import { PEDAL_MIME } from "./dnd"

const BLURBS: Record<string, string> = {
  filter: "Low-, high- or band-pass with resonance",
  ladder: "Warm, squelchy analog-style filter",
  drive: "Saturation and distortion, from warm to fuzzy",
  reverb: "A room, a hall, or frozen in place",
  delay: "Repeats that darken as they fade",
  pan: "Place the sound left or right; widen or narrow it",
  gain: "Make it louder or quieter",
  convolution: "Put the sound in a real space: a room, a hall, a spring tank",
}

function Item({ spec }: { spec: PedalSpec }) {
  const addPedal = useEditor((s) => s.addPedal)
  return (
    <li>
      <button
        type="button"
        className="palette-item"
        draggable
        title="Drag onto the board, or click to add at the end."
        onDragStart={(e) => {
          e.dataTransfer.setData(PEDAL_MIME, spec.type)
          e.dataTransfer.effectAllowed = "copy"
        }}
        onClick={() => addPedal(spec.type)}
        style={{ "--cat": pedalColor(spec) } as React.CSSProperties}
      >
        <strong>{spec.label}</strong>
        <span>{BLURBS[spec.type] ?? `${spec.knobs.map((k) => k.label).join(", ")}`}</span>
      </button>
    </li>
  )
}

function SplitItem({ mode, label, blurb }: { mode: "parallel" | "bands"; label: string; blurb: string }) {
  const addSplit = useEditor((s) => s.addSplit)
  return (
    <li>
      <button
        type="button"
        className="palette-item"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PEDAL_MIME, `split:${mode}`)
          e.dataTransfer.effectAllowed = "copy"
        }}
        onClick={() => addSplit(mode)}
        style={{ "--cat": "var(--accent)" } as React.CSSProperties}
      >
        <strong>{label}</strong>
        <span>{blurb}</span>
      </button>
    </li>
  )
}

export function AudioPalette() {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({ new: true, split: true })
  const q = query.trim().toLowerCase()
  const pedals = useMemo(
    () => PEDALS.filter((p) => !q || p.label.toLowerCase().includes(q) || p.category.includes(q)),
    [q],
  )
  const groups: { id: string; label: string; color: string; items: PedalSpec[] }[] = [
    { id: "new", label: "Pedals", color: "var(--accent)", items: pedals.filter((p) => !p.capabilities.legacyClassic) },
    ...PEDAL_GROUPS.map((g) => ({ ...g, label: `Classic ${g.label.toLowerCase()}`, items: pedals.filter((p) => p.capabilities.legacyClassic && p.category === g.id) })),
  ]

  return (
    <aside className="palette" aria-label="Pedals">
      <input className="input palette-search" placeholder="Search pedals" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="palette-scroll">
        {!q && (
          <section className="palette-group">
            <button type="button" className="palette-cat" aria-expanded={!!open.split} onClick={() => setOpen((o) => ({ ...o, split: !o.split }))}>
              <span className="cat-dot" style={{ background: "var(--accent)" }} />
              Splits
              <span className="palette-count">2</span>
            </button>
            {open.split && (
              <ul>
                <SplitItem mode="parallel" label="Parallel split" blurb="Run lanes side by side and mix them, like wet and dry" />
                <SplitItem mode="bands" label="Band split" blurb="Treat lows, mids and highs separately" />
              </ul>
            )}
          </section>
        )}
        {groups.map((g) => {
          if (!g.items.length) return null
          const isOpen = q !== "" || !!open[g.id]
          return (
            <section key={g.id} className="palette-group">
              <button type="button" className="palette-cat" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}>
                <span className="cat-dot" style={{ background: g.color }} />
                {g.label}
                <span className="palette-count">{g.items.length}</span>
              </button>
              {isOpen && (
                <ul>
                  {g.items.map((p) => (
                    <Item key={p.type} spec={p} />
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
