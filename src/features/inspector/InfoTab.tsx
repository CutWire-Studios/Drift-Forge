import { KIND_INFO } from "@/core/doc/kinds"
import type { ForgeDoc } from "@/core/doc/types"
import { useDoc, useEditor } from "@/state/editor"
import { ScrubNumber } from "@/shared/ui/widgets"

export function InfoTab() {
  const doc = useDoc()
  const update = useEditor((s) => s.update)
  const set = (patch: Partial<ForgeDoc["meta"]>) => update((d) => void Object.assign(d.meta, patch))
  const cats = KIND_INFO[doc.kind].categories
  const idOk = /^[a-z0-9][a-z0-9_.]*$/.test(doc.meta.id)

  return (
    <div className="stack gap-3">
      <label className="field">
        <span>Name</span>
        <input className="input input-sm" value={doc.meta.displayName} onChange={(e) => set({ displayName: e.target.value })} />
      </label>
      <label className="field">
        <span>Category in Drift</span>
        <input className="input input-sm" list="forge-cats" value={doc.meta.category} onChange={(e) => set({ category: e.target.value })} />
        <datalist id="forge-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          className="input input-sm textarea"
          rows={3}
          value={doc.meta.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <div className="row gap-2">
        <label className="field">
          <span>Author</span>
          <input className="input input-sm" value={doc.meta.author} onChange={(e) => set({ author: e.target.value })} />
        </label>
        <label className="field">
          <span>Version</span>
          <input className="input input-sm" value={doc.meta.version} onChange={(e) => set({ version: e.target.value })} />
        </label>
      </div>
      {doc.kind === "effect" && (
        <label className="field">
          <span>Thumbnail moment (seconds)</span>
          <ScrubNumber
            value={doc.preview.thumbTime}
            min={0}
            max={10}
            onChange={(v) => update((d) => void (d.preview.thumbTime = v))}
          />
        </label>
      )}
      <details className="advanced">
        <summary>Advanced</summary>
        <label className="field">
          <span>Package id</span>
          <input className="input input-sm mono" value={doc.meta.id} onChange={(e) => set({ id: e.target.value.trim() })} />
          {!idOk && <span className="field-error">Use lowercase letters, digits, _ and . only.</span>}
          <span className="meta small">
            Drift remembers effects in projects by this id. Keep it the same when you update an effect, or projects using
            the old one won't find it.
          </span>
        </label>
      </details>
    </div>
  )
}
