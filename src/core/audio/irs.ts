// Impulse responses for the convolution pedal: four built in (synthesized by scripts/make-irs.mjs,
// served from public/audio/ir), or a recording of the user's own stored in the document as an asset.
// Both end up in the package as ir/<name>.wav, which is what Drift's graph loads. Fetching and
// decoding them is the browser's job: services/audio-preview/irLoader.ts.
import { allItems, builtinIr, irPath, rackOf } from "@/core/audio/rack"
import { isSplit, type ForgeDoc } from "@/core/doc/types"
import { base64ToBytes } from "@/core/doc/util"

export const BUILTIN_IRS: { id: string; label: string }[] = [
  { id: "room", label: "Small room" },
  { id: "plate", label: "Plate" },
  { id: "hall", label: "Concert hall" },
  { id: "spring", label: "Spring tank" },
]

/** Longer tails cost the mixer more and the document more; six seconds covers a cathedral. */
export const MAX_IR_SECONDS = 6
export const IR_RATE = 48000

export function irLabel(doc: ForgeDoc, ir: string | undefined): string {
  if (!ir) return "None"
  const builtin = builtinIr(ir)
  if (builtin !== null) return BUILTIN_IRS.find((b) => b.id === builtin)?.label ?? builtin
  return doc.assets.find((a) => a.id === ir)?.name ?? "Missing recording"
}

export const audioAssets = (doc: ForgeDoc) => doc.assets.filter((a) => a.mime.startsWith("audio/"))

/** Every impulse response the document's board uses, by its path in the package. */
export async function irFiles(doc: ForgeDoc, loadBuiltin: (name: string) => Promise<Uint8Array>): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const item of allItems(rackOf(doc))) {
    if (isSplit(item) || !item.ir) continue
    const path = irPath(doc, item.ir)
    if (files.has(path)) continue
    const builtin = builtinIr(item.ir)
    if (builtin !== null) files.set(path, await loadBuiltin(builtin))
    else {
      const asset = doc.assets.find((a) => a.id === item.ir)
      if (asset) files.set(path, base64ToBytes(asset.data))
    }
  }
  return files
}
