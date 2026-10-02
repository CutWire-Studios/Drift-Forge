import { useEffect, useMemo, useState } from "react"
import { compile } from "@/compiler/compile"
import { MIN_APP_VERSION } from "@/compiler/manifest"
import type { ForgeDoc } from "@/doc/types"
import { base64ToBytes } from "@/doc/util"
import { exportDriftfx, exportZip } from "@/export/archive"
import { download, imageDataToPng, shrinkAssets } from "@/export/images"
import { encodeLinkPayload, LINK_LIMIT } from "@/export/link"
import { packageRoot } from "@/export/package"
import { getEngine } from "@/runtime/engine"
import { useEditor } from "@/state/editor"
import { Modal } from "../Modal"
import { toast } from "../toast"

function dataUrlBytes(url: string): Uint8Array {
  return base64ToBytes(url.slice(url.indexOf(",") + 1))
}

async function previewPng(doc: ForgeDoc): Promise<Uint8Array | null> {
  if (doc.kind === "effect" && doc.preview.customThumb) return dataUrlBytes(doc.preview.customThumb)
  const img = getEngine().renderPackagePreview(doc)
  return typeof img === "string" ? null : imageDataToPng(img)
}

function osFolder(doc: ForgeDoc): string {
  const sub = packageRoot(doc)
  const ua = navigator.userAgent
  if (/Windows/.test(ua)) return `%APPDATA%\\CutWire Drift\\CutWire Drift\\${sub}\\`
  if (/Mac OS X/.test(ua) && !/Mobile/.test(ua)) return `~/Library/Application Support/CutWire Drift/CutWire Drift/${sub}/`
  return `~/.local/share/CutWire Drift/CutWire Drift/${sub}/`
}

async function squareThumb(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const c = document.createElement("canvas")
  c.width = c.height = 256
  const s = Math.max(256 / bmp.width, 256 / bmp.height)
  c.getContext("2d")!.drawImage(bmp, (256 - bmp.width * s) / 2, (256 - bmp.height * s) / 2, bmp.width * s, bmp.height * s)
  return c.toDataURL("image/png")
}

export function ExportDialog({ onClose, onShowCode }: { onClose: () => void; onShowCode: () => void }) {
  const doc = useEditor((s) => s.doc!)
  const update = useEditor((s) => s.update)
  const errors = useMemo(() => compile(doc, { mode: "export" }).errors, [doc])
  const [png, setPng] = useState<Uint8Array | null>(null)
  const [link, setLink] = useState<{ url: string } | { tooLong: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const idOk = /^[a-z0-9][a-z0-9_.]*$/.test(doc.meta.id)
  const ok = errors.length === 0 && idOk

  useEffect(() => {
    if (!ok) return
    let live = true
    previewPng(doc).then((b) => live && setPng(b))
    shrinkAssets(doc)
      .then(encodeLinkPayload)
      .then((payload) => {
        if (!live) return
        const url = `${location.origin}/#${payload}`
        setLink(url.length > LINK_LIMIT ? { tooLong: url.length } : { url })
      })
      .catch(() => live && setLink(null))
    return () => {
      live = false
    }
  }, [doc, ok])

  const previewUrl = useMemo(() => (png ? URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" })) : null), [png])
  const fileBase = doc.meta.displayName.replace(/[^\w\- ]+/g, "").trim() || doc.meta.id

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Export “${doc.meta.displayName}”`} onClose={onClose} wide>
      {!ok ? (
        <div className="export-problems" role="alert">
          <strong>Fix these first:</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
            {!idOk && <li>The package id (Details → Advanced) can only use lowercase letters, digits, _ and .</li>}
          </ul>
        </div>
      ) : (
        <div className="export">
          <div className="export-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="Preview Drift will show" className={doc.kind === "transition" ? "strip" : "thumb"} />
            ) : (
              <div className="skeleton thumb" />
            )}
            <div className="meta small">
              {doc.kind === "effect" ? (
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
              ) : (
                "Preview strip Drift scrubs when you hover the transition."
              )}
            </div>
          </div>

          <div className="export-options">
            <div className="export-card">
              <div>
                <h4>Zip for Drift</h4>
                <p className="meta">
                  Works today. Unzip it into <code>{osFolder(doc)}</code> and restart Drift. Needs Drift {MIN_APP_VERSION} or newer.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => run(async () => download(`${fileBase}.zip`, exportZip(doc, { png }), "application/zip"))}
              >
                Download .zip
              </button>
            </div>

            <div className="export-card">
              <div>
                <h4>Drift package</h4>
                <p className="meta">
                  A single <code>.driftfx</code> file. Drift will open these directly in a future update. You can always reopen it
                  here to keep editing.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() =>
                  run(async () => download(`${fileBase}.driftfx`, await exportDriftfx(doc, { png }), "application/octet-stream"))
                }
              >
                Download .driftfx
              </button>
            </div>

            <div className="export-card">
              <div>
                <h4>Share link</h4>
                {link === null ? (
                  <p className="meta">Preparing…</p>
                ) : "url" in link ? (
                  <>
                    <p className="meta">
                      Anyone with the link opens their own copy in Drift Forge. Everything is inside the link; nothing is uploaded.
                    </p>
                    <div className="link-meter">
                      <span style={{ width: `${Math.min(100, (link.url.length / LINK_LIMIT) * 100)}%` }} />
                    </div>
                    <p className="meta small">{(link.url.length / 1024).toFixed(1)} KB of {LINK_LIMIT / 1024} KB</p>
                  </>
                ) : (
                  <p className="meta">
                    Too big for a link ({(link.tooLong / 1024).toFixed(0)} KB, limit {LINK_LIMIT / 1024} KB), usually because of
                    pictures. Share the <code>.driftfx</code> file instead.
                  </p>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!link || !("url" in link)}
                onClick={async () => {
                  if (link && "url" in link) {
                    await navigator.clipboard.writeText(link.url)
                    toast("Link copied")
                  }
                }}
              >
                Copy link
              </button>
            </div>
          </div>

          <button type="button" className="link-btn" onClick={onShowCode}>
            View or copy the shader code
          </button>
        </div>
      )}
    </Modal>
  )
}
