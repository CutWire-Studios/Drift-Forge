import { strToU8, unzipSync, zipSync, type Zippable } from "fflate"
import type { ForgeDoc } from "@/doc/types"
import { MIN_APP_VERSION } from "@/compiler/manifest"
import { readDriftfx, writeDriftfx } from "./driftfx"
import { FORGE_FILE, GENERATOR, installText, packageFiles, packageRoot, type PreviewImages } from "./package"
import { parseForgeDoc } from "./link"

export function exportZip(doc: ForgeDoc, preview: PreviewImages): Uint8Array {
  const { files } = packageFiles(doc, preview)
  const tree: Zippable = { "INSTALL.txt": strToU8(installText(doc)) }
  for (const f of files) tree[`${doc.meta.id}/${f.path}`] = f.data
  return zipSync(tree, { level: 9 })
}

export async function exportDriftfx(doc: ForgeDoc, preview: PreviewImages): Promise<Uint8Array> {
  const { files } = packageFiles(doc, preview)
  const root = packageRoot(doc)
  return writeDriftfx(
    {
      id: `user.${doc.meta.id}`,
      version: doc.meta.version || "1.0.0",
      name: doc.meta.displayName,
      description: doc.meta.description,
      details: `Made with Drift Forge. ${doc.kind === "effect" ? "Effect" : "Transition"} id: ${doc.meta.id}.`,
      author: doc.meta.author,
      license: "",
      minAppVersion: MIN_APP_VERSION,
      provides: [{ kind: root, root, items: 1 }],
      generator: GENERATOR,
    },
    files.map((f) => ({ path: `${root}/${doc.meta.id}/${f.path}`, data: f.data })),
  )
}

export class ImportError extends Error {}

/** Opens a .driftfx, a Forge-exported zip, or a bare forge.json. */
export async function importFile(name: string, bytes: Uint8Array): Promise<ForgeDoc> {
  const text = (b: Uint8Array) => new TextDecoder().decode(b)
  if (name.endsWith(".driftfx")) {
    const { files } = await readDriftfx(bytes)
    const forge = files.find((f) => f.path.endsWith(`/${FORGE_FILE}`))
    if (!forge) throw new ImportError("This package wasn't made with Drift Forge, so it can't be edited here.")
    return parseForgeDoc(text(forge.data))
  }
  if (name.endsWith(".zip")) {
    const entries = unzipSync(bytes, { filter: (f) => f.name.endsWith(FORGE_FILE) })
    const forge = Object.values(entries)[0]
    if (!forge) throw new ImportError("This zip has no forge.json, so it wasn't made with Drift Forge.")
    return parseForgeDoc(text(forge))
  }
  if (name.endsWith(".json")) return parseForgeDoc(text(bytes))
  throw new ImportError("Open a .driftfx, a .zip exported from Drift Forge, or a forge.json file.")
}
