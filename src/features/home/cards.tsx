import { useEffect, useState } from "react"
import { Link } from "react-router"
import { KIND_INFO } from "@/core/doc/kinds"
import type { ForgeDoc } from "@/core/doc/types"
import type { Starter } from "@/core/starters"
import { renderCardThumb } from "@/services/preview/cardThumb"
import type { LibraryEntry } from "@/services/storage/library"

function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString()
}

function useCardThumb(doc: ForgeDoc, stored?: string) {
  const [src, setSrc] = useState(stored ?? null)
  useEffect(() => {
    // Audio effects have no picture to render.
    if (stored || doc.kind === "audio") return
    let live = true
    renderCardThumb(doc)
      .then((url) => live && setSrc(url))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [doc, stored])
  return src
}

export function StarterCard({ starter, onPick }: { starter: Starter; onPick: () => void }) {
  const thumb = useCardThumb(starter.doc)
  return (
    <button type="button" className="card starter-card" onClick={onPick}>
      <div className="card-thumb">{thumb ? <img src={thumb} alt="" /> : <div className="skeleton" />}</div>
      <div className="card-text">
        <strong>{starter.name}</strong>
        <span className="meta">{starter.description}</span>
      </div>
    </button>
  )
}

function CardThumb({ doc, thumb }: { doc: ForgeDoc; thumb: string | null }) {
  if (doc.kind === "audio") {
    return (
      <div className="audio-thumb" aria-hidden="true">
        ♪
      </div>
    )
  }
  if (thumb) return <img src={thumb} alt="" />
  return <div className="skeleton" />
}

export function LibraryCard({ entry, onDelete, onDuplicate }: { entry: LibraryEntry; onDelete: () => void; onDuplicate: () => void }) {
  const thumb = useCardThumb(entry.doc, entry.thumb)
  return (
    <div className="card lib-card">
      <Link to={`/edit/${entry.localId}`} className="card-thumb">
        <CardThumb doc={entry.doc} thumb={thumb} />
        <span className="pill kind-pill">{KIND_INFO[entry.doc.kind].label}</span>
      </Link>
      <div className="card-text">
        <Link to={`/edit/${entry.localId}`}>
          <strong>{entry.doc.meta.displayName}</strong>
        </Link>
        <span className="meta">Edited {ago(entry.updatedAt)}</span>
      </div>
      <div className="card-actions">
        <button type="button" className="btn btn-tertiary btn-sm" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="btn btn-tertiary btn-sm danger-text" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
