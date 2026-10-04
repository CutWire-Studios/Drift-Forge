import { compile, type CompileResult } from "@/compiler/compile"
import { imageParamFile, MIN_APP_VERSION, packageJson, packageJsonName } from "@/compiler/manifest"
import type { ForgeDoc } from "@/doc/types"
import { base64ToBytes } from "@/doc/util"
import type { PackFile } from "./driftfx"

export const FORGE_FILE = "forge.json"
export const GENERATOR = "drift-forge/0.1.0"

export interface PreviewImages {
  /** effect thumbnail.png (256×256) or transition preview_strip.png (1536×128) */
  png: Uint8Array | null
}

export function packageRoot(doc: ForgeDoc): "effects" | "transitions" | "audio-effects" {
  return doc.kind === "effect" ? "effects" : doc.kind === "audio" ? "audio-effects" : "transitions"
}

export function previewFileName(doc: ForgeDoc): string {
  return doc.kind === "effect" ? "thumbnail.png" : "preview_strip.png"
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
"${doc.meta.category}" in Drift's ${doc.kind === "effect" ? "effects" : doc.kind === "audio" ? "audio effects" : "transitions"} browser.

Requires Drift ${minVersion} or newer.

To edit this ${doc.kind} again, open forge.json (or the whole zip) in Drift Forge.
`
}
