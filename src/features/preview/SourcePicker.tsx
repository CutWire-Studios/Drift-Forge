import { useRef } from "react"
import { getEngine } from "@/services/preview/engine"
import { SAMPLES, userMedia, type MediaItem } from "@/services/preview/media"
import { useEngineStatus } from "./useEngine"
import { useUploads } from "./uploads"

const GROUPS: { kind: MediaItem["kind"]; label: string }[] = [
  { kind: "video", label: "Clips" },
  { kind: "image", label: "Photos" },
  { kind: "pattern", label: "Test patterns" },
]

export function SourcePicker({ index, label }: { index: 0 | 1 | 2; label: string }) {
  const engine = getEngine()
  const current = useEngineStatus((s) => s.sources[index]) || engine.sources()[index].id
  const uploads = useUploads((s) => s.media)
  const addMedia = useUploads((s) => s.addMedia)
  const file = useRef<HTMLInputElement>(null)
  const all = [...SAMPLES, ...uploads]
  const choose = (item: MediaItem) => void engine.setSource(index, item)
  return (
    <label className="source-picker">
      <span>{label}</span>
      <select
        className="input input-sm"
        value={current}
        onChange={(e) => {
          if (e.target.value === "__upload") file.current?.click()
          else choose(all.find((m) => m.id === e.target.value)!)
        }}
      >
        {GROUPS.map((g) => (
          <optgroup key={g.kind} label={g.label}>
            {all.filter((m) => m.kind === g.kind).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value="__upload">Use my own photo or video…</option>
      </select>
      <input
        ref={file}
        type="file"
        accept="image/*,video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          const item = userMedia(f)
          addMedia(item)
          choose(item)
        }}
      />
    </label>
  )
}
