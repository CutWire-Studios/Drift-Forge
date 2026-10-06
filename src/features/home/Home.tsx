import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"
import { errorMessage } from "@/core/errors"
import { KIND_INFO } from "@/core/doc/kinds"
import type { ForgeDoc, Kind } from "@/core/doc/types"
import { emptyDoc, makeEffectId } from "@/core/doc/util"
import { importFile } from "@/core/export/archive"
import { STARTERS } from "@/core/starters"
import { createEntry, deleteEntry, listLibrary, type LibraryEntry } from "@/services/storage/library"
import { AppHeader } from "@/shared/ui/AppHeader"
import { Modal } from "@/shared/ui/Modal"
import { toast } from "@/shared/ui/toast"
import { LibraryCard, StarterCard } from "./cards"
import { useUrlActions } from "./useUrlActions"
import "./home.css"

function freshCopy(doc: ForgeDoc, name = doc.meta.displayName): ForgeDoc {
  const d = structuredClone(doc)
  d.meta.displayName = name
  d.meta.id = makeEffectId(name)
  return d
}

export function Home() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [picker, setPicker] = useState<Kind | null>(null)
  const opening = useUrlActions()
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => listLibrary().then(setEntries)
  useEffect(() => {
    refresh()
  }, [])

  const start = async (doc: ForgeDoc) => {
    const id = await createEntry(doc)
    navigate(`/edit/${id}`)
  }

  const openFile = async (file: File) => {
    try {
      const doc = await importFile(file.name.toLowerCase(), new Uint8Array(await file.arrayBuffer()))
      await start(doc)
    } catch (e) {
      toast(errorMessage(e), "error")
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
          <h1>Make your own effects, transitions and audio effects for Drift</h1>
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
            <button type="button" className="new-card" onClick={() => start(emptyDoc("audio"))}>
              <span className="new-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="28" height="28">
                  <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
                </svg>
              </span>
              <strong>New audio effect</strong>
              <span className="meta">Reshapes sound: echo, chorus, EQ, voice effects…</span>
            </button>
          </div>
        </section>

        <section className="library">
          <h2>Your creations</h2>
          <Library entries={entries} refresh={refresh} />
        </section>
      </main>

      {picker && (
        <Modal title={`Start a new ${KIND_INFO[picker].label.toLowerCase()}`} onClose={() => setPicker(null)} wide>
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

function Library({ entries, refresh }: { entries: LibraryEntry[] | null; refresh: () => void }) {
  if (entries === null) return null
  if (!entries.length) {
    return (
      <p className="meta">
        Nothing yet. Start with a new effect above, or drop a <code>.driftfx</code> or <code>.zip</code> from
        Drift Forge onto this page.
      </p>
    )
  }
  return (
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
  )
}
