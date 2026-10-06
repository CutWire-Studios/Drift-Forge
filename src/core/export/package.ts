import { KIND_INFO, type KindInfo } from "@/core/doc/kinds"
import { compile, type CompileResult } from "@/core/compiler/compile"
import { MIN_APP_VERSION, packageJson, packageJsonName } from "@/core/compiler/manifest"
import { imageParamFile } from "@/core/doc/params"
import { allItems, irPath, rackOf } from "@/core/audio/rack"
import { isSplit, type ForgeDoc } from "@/core/doc/types"
import { base64ToBytes } from "@/core/doc/util"
import type { PackFile } from "./driftfx"

export const FORGE_FILE = "forge.json"
export const GENERATOR = "drift-forge/0.1.0"

export interface PreviewImages {
  /** effect thumbnail.png (256×256) or transition preview_strip.png (1536×128) */
  png: Uint8Array | null
  /** audio: the board's impulse responses by package path (audio/irs.ts irFiles) */
  irs?: Map<string, Uint8Array>
}

export function packageRoot(doc: ForgeDoc): KindInfo["packageRoot"] {
  return KIND_INFO[doc.kind].packageRoot
}

export function previewFileName(doc: ForgeDoc): string {
  return KIND_INFO[doc.kind].previewFile
}

/** The document as stored in forge.json: everything needed to reopen it in Forge. */
export function forgeJson(doc: ForgeDoc): string {
  return JSON.stringify(doc, null, 2)
}

export class ExportError extends Error {}

/**
 * Files of one Drift package folder, paths relative to the folder itself:
 * effect.json/transition.json, every pass .frag, the preview image, textures and forge.json.
 */
export function packageFiles(doc: ForgeDoc, preview: PreviewImages): { files: PackFile[]; compiled: CompileResult } {
  const compiled = compile(doc, { mode: "export" })
  if (!compiled.ok) throw new ExportError(compiled.errors.map((e) => e.message).join("\n"))
  const enc = new TextEncoder()
  const files: PackFile[] = [
    { path: packageJsonName(doc), data: enc.encode(JSON.stringify(packageJson(doc, compiled), null, 2) + "\n") },
    ...compiled.passes.map((p) => ({ path: p.file, data: enc.encode(p.source) })),
    { path: FORGE_FILE, data: enc.encode(forgeJson(doc)) },
  ]
  for (const t of compiled.textures) {
    const asset = doc.assets.find((a) => a.id === t.assetId)!
    files.push({ path: t.file, data: base64ToBytes(asset.data) })
  }
  for (const p of doc.params) {
    const file = p.type === "image" ? imageParamFile(doc, p) : null
    if (file) files.push({ path: file, data: base64ToBytes(doc.assets.find((a) => a.id === p.default)!.data) })
  }
  if (preview.png) files.push({ path: previewFileName(doc), data: preview.png })
  if (doc.kind === "audio") {
    const paths = new Set<string>()
    for (const item of allItems(rackOf(doc))) if (!isSplit(item) && item.ir) paths.add(irPath(doc, item.ir))
    for (const path of paths) {
      const data = preview.irs?.get(path)
      if (!data) throw new ExportError(`The impulse response ${path} wasn't loaded; try exporting again.`)
      files.push({ path, data })
    }
  }
  return { files, compiled }
}

export function installText(doc: ForgeDoc, minVersion: string = MIN_APP_VERSION): string {
  const sub = packageRoot(doc)
  return `${doc.meta.displayName} — made with Drift Forge
${"=".repeat(doc.meta.displayName.length + 25)}

Install on desktop: copy the "${doc.meta.id}" folder into Drift's ${sub} folder, then restart Drift.

  Linux:    ~/.local/share/CutWire Drift/CutWire Drift/${sub}/
  Windows:  %APPDATA%\\CutWire Drift\\CutWire Drift\\${sub}\\
  macOS:    ~/Library/Application Support/CutWire Drift/CutWire Drift/${sub}/

Create the "${sub}" folder if it doesn't exist yet. The ${doc.kind} appears under
"${doc.meta.category}" in Drift's ${KIND_INFO[doc.kind].browserName} browser.

Requires Drift ${minVersion} or newer.

To edit this ${doc.kind} again, open forge.json (or the whole zip) in Drift Forge.
`
}
