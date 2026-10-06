import { useEffect, useMemo, useState } from "react"
import { minAppVersion } from "@/core/compiler/manifest"
import { errorMessage } from "@/core/errors"
import type { ForgeDoc } from "@/core/doc/types"
import { base64ToBytes } from "@/core/doc/util"
import { exportDriftfx, exportZip } from "@/core/export/archive"
import { encodeLinkPayload, LINK_LIMIT } from "@/core/export/link"
import { packageRoot } from "@/core/export/package"
import { getEngine } from "@/services/preview/engine"
import { download, imageDataToPng, shrinkAssets } from "@/services/storage/assets"
import { useDoc } from "@/state/editor"
import { useCompiled } from "@/state/useCompiled"
import { Modal } from "@/shared/ui/Modal"
import { toast } from "@/shared/ui/toast"
import { PreviewImage } from "./PreviewImage"
import "./export.css"

type ShareLink = { url: string } | { tooLong: number } | null

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

/** The package preview picture and the share link, worked out in the background. */
function useExportArtifacts(doc: ForgeDoc) {
  const [png, setPng] = useState<Uint8Array | null>(null)
  const [link, setLink] = useState<ShareLink>(null)
  useEffect(() => {
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
  }, [doc])
  return { png, link }
}

export function ExportDialog({ onClose, onShowCode }: { onClose: () => void; onShowCode: () => void }) {
  const doc = useDoc()
  const compiled = useCompiled()
  const idOk = /^[a-z0-9][a-z0-9_.]*$/.test(doc.meta.id)
  const ok = compiled.errors.length === 0 && idOk

  return (
    <Modal title={`Export “${doc.meta.displayName}”`} onClose={onClose} wide>
      {ok ? (
        <ExportOptions doc={doc} onShowCode={onShowCode} />
      ) : (
        <div className="export-problems" role="alert">
          <strong>Fix these first:</strong>
          <ul>
            {compiled.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
            {!idOk && <li>The package id (Details → Advanced) can only use lowercase letters, digits, _ and .</li>}
          </ul>
        </div>
      )}
    </Modal>
  )
}

function ExportOptions({ doc, onShowCode }: { doc: ForgeDoc; onShowCode: () => void }) {
  const compiled = useCompiled()
  const neededVersion = useMemo(() => minAppVersion(doc, compiled), [doc, compiled])
  const { png, link } = useExportArtifacts(doc)
  const [busy, setBusy] = useState(false)
  const fileBase = doc.meta.displayName.replace(/[^\w\- ]+/g, "").trim() || doc.meta.id

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="export">
      <PreviewImage doc={doc} png={png} />

      <div className="export-options">
        <div className="export-card">
          <div>
            <h4>Zip for Drift</h4>
            <p className="meta">
              Works today. Unzip it into <code>{osFolder(doc)}</code> and restart Drift. Needs Drift {neededVersion} or newer.
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

        <ShareLinkCard link={link} />
      </div>

      <button type="button" className="link-btn" onClick={onShowCode}>
        View or copy the shader code
      </button>
    </div>
  )
}

function ShareLinkStatus({ link }: { link: ShareLink }) {
  if (link === null) return <p className="meta">Preparing…</p>
  if ("tooLong" in link) {
    return (
      <p className="meta">
        Too big for a link ({(link.tooLong / 1024).toFixed(0)} KB, limit {LINK_LIMIT / 1024} KB), usually because of
        pictures. Share the <code>.driftfx</code> file instead.
      </p>
    )
  }
  return (
    <>
      <p className="meta">Anyone with the link opens their own copy in Drift Forge. Everything is inside the link; nothing is uploaded.</p>
      <div className="link-meter">
        <span style={{ width: `${Math.min(100, (link.url.length / LINK_LIMIT) * 100)}%` }} />
      </div>
      <p className="meta small">{(link.url.length / 1024).toFixed(1)} KB of {LINK_LIMIT / 1024} KB</p>
    </>
  )
}

function ShareLinkCard({ link }: { link: ShareLink }) {
  const url = link && "url" in link ? link.url : null
  return (
    <div className="export-card">
      <div>
        <h4>Share link</h4>
        <ShareLinkStatus link={link} />
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!url}
        onClick={async () => {
          if (!url) return
          await navigator.clipboard.writeText(url)
          toast("Link copied")
        }}
      >
        Copy link
      </button>
    </div>
  )
}
