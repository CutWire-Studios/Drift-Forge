import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import type { ForgeDoc, Kind } from "@/doc/types"
import { makeEffectId } from "@/doc/util"
import { importFile } from "@/export/archive"
import { decodeLinkPayload } from "@/export/link"
import { renderCardThumb } from "@/runtime/engine"
import { createEntry, deleteEntry, listLibrary, type LibraryEntry } from "@/storage/library"
import { STARTERS, type Starter } from "@/starters"
import { AppHeader } from "./AppHeader"
import { Modal } from "./Modal"
import { toast } from "./toast"

function freshCopy(doc: ForgeDoc, name = doc.meta.displayName): ForgeDoc {
  const d = structuredClone(doc)
  d.meta.displayName = name
  d.meta.id = makeEffectId(name)
  return d
}

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
    if (stored) return
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

function StarterCard({ starter, onPick }: { starter: Starter; onPick: () => void }) {
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

function LibraryCard({ entry, onDelete, onDuplicate }: { entry: LibraryEntry; onDelete: () => void; onDuplicate: () => void }) {
  const thumb = useCardThumb(entry.doc, entry.thumb)
  return (
    <div className="card lib-card">
      <Link to={`/edit/${entry.localId}`} className="card-thumb">
        {thumb ? <img src={thumb} alt="" /> : <div className="skeleton" />}
        <span className="pill kind-pill">{entry.doc.kind === "effect" ? "Effect" : "Transition"}</span>
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

export function Home() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [picker, setPicker] = useState<Kind | null>(null)
  const [opening, setOpening] = useState(() => location.hash.startsWith("#v1."))
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => listLibrary().then(setEntries)

  useEffect(() => {
    refresh()
    const err = new URLSearchParams(location.search).get("signin_error")
    if (err) {
      toast(err, "error")
      history.replaceState(null, "", "/")
    }
  }, [])

  // Share links carry the whole document in the fragment, which never reaches a server.
  useEffect(() => {
    const payload = location.hash.slice(1)
    if (!payload.startsWith("v1.")) return
    decodeLinkPayload(payload)
      .then((doc) => createEntry(doc))
      .then((id) => navigate(`/edit/${id}`, { replace: true }))
      .catch((e: Error) => {
        toast(e.message, "error")
        history.replaceState(null, "", "/")
        setOpening(false)
      })
  }, [navigate])

  const start = async (doc: ForgeDoc) => {
    const id = await createEntry(doc)
    navigate(`/edit/${id}`)
  }

  const openFile = async (file: File) => {
    try {
      const doc = await importFile(file.name.toLowerCase(), new Uint8Array(await file.arrayBuffer()))
      await start(doc)
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }

  if (opening) {
    return (
      <>
        <AppHeader />
        <main className="page empty-page">
          <h2>Opening shared effect…</h2>
        </main>
      </>
    )
  }

  return (
    <>
      <AppHeader>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          Open file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".driftfx,.zip,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) openFile(f)
          }}
        />
      </AppHeader>
      <main
        className="page home"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) openFile(f)
        }}
      >
        <section className="hero">
          <h1>Make your own effects and transitions for Drift</h1>
          <p className="hero-sub">
            Connect building blocks, watch the result live, then drop it straight into Drift. No code needed, and
            everything stays in your browser.
          </p>
          <div className="new-cards">
            <button type="button" className="new-card" onClick={() => setPicker("effect")}>
              <span className="new-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <path d="M12 3l2.2 5.6L20 9.5l-4.5 3.9L17 19l-5-3-5 3 1.5-5.6L4 9.5l5.8-.9z" fill="currentColor" />
                </svg>
              </span>
              <strong>New effect</strong>
              <span className="meta">Changes how a clip looks: colour, glitch, glow, distortion…</span>
            </button>
            <button type="button" className="new-card" onClick={() => setPicker("transition")}>
              <span className="new-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <rect x="3" y="5" width="9" height="14" rx="2" fill="currentColor" opacity=".45" />
                  <rect x="12" y="5" width="9" height="14" rx="2" fill="currentColor" />
                </svg>
              </span>
              <strong>New transition</strong>
              <span className="meta">Moves from one clip to the next: wipes, dissolves, pushes…</span>
            </button>
          </div>
        </section>

        <section className="library">
          <h2>Your creations</h2>
          {entries === null ? null : entries.length === 0 ? (
            <p className="meta">
              Nothing yet. Start with a new effect above, or drop a <code>.driftfx</code> or <code>.zip</code> from
              Drift Forge onto this page.
            </p>
          ) : (
            <div className="card-grid">
              {entries.map((e) => (
                <LibraryCard
                  key={e.localId}
                  entry={e}
                  onDuplicate={async () => {
                    await createEntry(freshCopy(e.doc, `${e.doc.meta.displayName} copy`), e.thumb)
                    refresh()
                  }}
                  onDelete={async () => {
                    if (!confirm(`Delete "${e.doc.meta.displayName}"? This can't be undone.`)) return
                    await deleteEntry(e.localId)
                    refresh()
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {picker && (
        <Modal title={picker === "effect" ? "Start a new effect" : "Start a new transition"} onClose={() => setPicker(null)} wide>
          <div className="card-grid starter-grid">
            {STARTERS.filter((s) => s.doc.kind === picker).map((s) => (
              <StarterCard key={s.name} starter={s} onPick={() => start(freshCopy(s.doc))} />
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
