import { useEffect, useMemo, useRef } from "react"
import { uid } from "@/core/doc/util"
import { assetBlob, assetFromFile } from "@/services/storage/assets"
import { useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"

export function AssetPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const assets = useDoc((d) => d.assets)
  const addAsset = useEditor((s) => s.addAsset)
  const urls = useMemo(() => new Map(assets.map((a) => [a.id, URL.createObjectURL(assetBlob(a))])), [assets])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  const input = useRef<HTMLInputElement>(null)

  const upload = async (f: File) => {
    try {
      const a = await assetFromFile(f, uid("a"))
      addAsset(a)
      onChange(a.id)
    } catch {
      toast("Couldn't read that picture.", "error")
    }
  }

  return (
    <>
      <div className="asset-grid">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`asset-tile${a.id === value ? " active" : ""}`}
            onClick={() => onChange(a.id)}
            title={a.name}
          >
            <img src={urls.get(a.id)} alt={a.name} />
          </button>
        ))}
        <button type="button" className="asset-tile asset-add" onClick={() => input.current?.click()}>
          + Upload
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) void upload(f)
        }}
      />
      <p className="meta small">Pictures are saved inside the effect and exported with it.</p>
    </>
  )
}
