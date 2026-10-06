import { useMemo } from "react"
import type { ForgeDoc } from "@/core/doc/types"
import { bytesToBase64 } from "@/core/doc/util"
import { useEditor } from "@/state/editor"

const THUMB_SIZE = 256

async function squareThumb(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const c = document.createElement("canvas")
  c.width = c.height = THUMB_SIZE
  const s = Math.max(THUMB_SIZE / bmp.width, THUMB_SIZE / bmp.height)
  c.getContext("2d")!.drawImage(bmp, (THUMB_SIZE - bmp.width * s) / 2, (THUMB_SIZE - bmp.height * s) / 2, bmp.width * s, bmp.height * s)
  return c.toDataURL("image/png")
}

// A data URL rather than an object URL: nothing to revoke, so it can be derived during render.
function usePngUrl(png: Uint8Array | null): string | null {
  return useMemo(() => (png ? `data:image/png;base64,${bytesToBase64(png)}` : null), [png])
}

export function PreviewImage({ doc, png }: { doc: ForgeDoc; png: Uint8Array | null }) {
  const url = usePngUrl(png)
  return (
    <div className="export-preview">
      {url ? (
        <img src={url} alt="Preview Drift will show" className={doc.kind === "transition" ? "strip" : "thumb"} />
      ) : (
        <div className="skeleton thumb" />
      )}
      <div className="meta small">{doc.kind === "effect" ? <ThumbnailPicker doc={doc} /> : "Preview strip Drift scrubs when you hover the transition."}</div>
    </div>
  )
}

function ThumbnailPicker({ doc }: { doc: ForgeDoc }) {
  const update = useEditor((s) => s.update)
  return (
    <>
      Thumbnail shown in Drift's effect browser.{" "}
      <label className="link-btn">
        Use my own picture
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) {
              const url = await squareThumb(f)
              update((d) => void (d.preview.customThumb = url))
            }
          }}
        />
      </label>
      {doc.preview.customThumb && (
        <>
          {" · "}
          <button type="button" className="link-btn" onClick={() => update((d) => void delete d.preview.customThumb)}>
            Use the rendered one
          </button>
        </>
      )}
    </>
  )
}
