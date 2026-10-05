// Impulse responses for the convolution pedal: four built in (synthesized by scripts/make-irs.mjs,
// served from public/audio/ir), or a recording of the user's own stored in the document as an asset.
// Both end up in the package as ir/<name>.wav, which is what Drift's graph loads.
import { allItems, irPath, rackOf } from "@/audio/rack"
import { isSplit, type ForgeAsset, type ForgeDoc } from "@/doc/types"
import { base64ToBytes, bytesToBase64, uid } from "@/doc/util"

export const BUILTIN_IRS: { id: string; label: string }[] = [
  { id: "room", label: "Small room" },
  { id: "plate", label: "Plate" },
  { id: "hall", label: "Concert hall" },
  { id: "spring", label: "Spring tank" },
]

/** Longer tails cost the mixer more and the document more; six seconds covers a cathedral. */
export const MAX_IR_SECONDS = 6
const IR_RATE = 48000

export function irLabel(doc: ForgeDoc, ir: string | undefined): string {
  if (!ir) return "None"
  if (ir.startsWith("builtin:")) return BUILTIN_IRS.find((b) => `builtin:${b.id}` === ir)?.label ?? ir.slice(8)
  return doc.assets.find((a) => a.id === ir)?.name ?? "Missing recording"
}

export const audioAssets = (doc: ForgeDoc) => doc.assets.filter((a) => a.mime.startsWith("audio/"))

const builtinCache = new Map<string, Promise<Uint8Array>>()

async function fetchBuiltin(name: string): Promise<Uint8Array> {
  let p = builtinCache.get(name)
  if (!p) {
    p = fetch(`/audio/ir/${name}.wav`).then(async (r) => {
      if (!r.ok) throw new Error(`Couldn't load the ${name} impulse response.`)
      return new Uint8Array(await r.arrayBuffer())
    })
    builtinCache.set(name, p)
    p.catch(() => builtinCache.delete(name))
  }
  return p
}

/** Every impulse response the document's board uses, by its path in the package. */
export async function irFiles(doc: ForgeDoc, loadBuiltin: (name: string) => Promise<Uint8Array> = fetchBuiltin): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const item of allItems(rackOf(doc))) {
    if (isSplit(item) || !item.ir) continue
    const path = irPath(doc, item.ir)
    if (files.has(path)) continue
    if (item.ir.startsWith("builtin:")) files.set(path, await loadBuiltin(item.ir.slice(8)))
    else {
      const asset = doc.assets.find((a) => a.id === item.ir)
      if (asset) files.set(path, base64ToBytes(asset.data))
    }
  }
  return files
}

function wav16(channels: Float32Array[], rate: number): Uint8Array {
  const n = channels[0].length
  const c = channels.length
  const out = new Uint8Array(44 + n * c * 2)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)))
  ascii(0, "RIFF")
  v.setUint32(4, 36 + n * c * 2, true)
  ascii(8, "WAVEfmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, c, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * c * 2, true)
  v.setUint16(32, c * 2, true)
  v.setUint16(34, 16, true)
  ascii(36, "data")
  v.setUint32(40, n * c * 2, true)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < c; k++) v.setInt16(44 + (i * c + k) * 2, Math.round(Math.max(-1, Math.min(1, channels[k][i])) * 32767), true)
  }
  return out
}

/**
 * A recording of the user's own as an impulse response: decoded and resampled to 48 kHz, cut to its
 * audible part (the silence after the tail is trimmed) and to MAX_IR_SECONDS, stored as 16-bit WAV.
 */
export async function irAssetFromFile(file: File): Promise<ForgeAsset> {
  const ctx = new OfflineAudioContext(2, 1, IR_RATE)
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c))
  let peak = 0
  for (const ch of channels) for (const s of ch) peak = Math.max(peak, Math.abs(s))
  if (peak === 0) throw new Error("That recording is silent.")
  // Keep everything down to -60 dB below its peak: past that, the tail is inaudible under the sound.
  let end = 0
  for (const ch of channels) for (let i = ch.length - 1; i > end; i--) if (Math.abs(ch[i]) > peak * 0.001) { end = i; break }
  const frames = Math.min(end + 1, MAX_IR_SECONDS * IR_RATE)
  const trimmed = channels.map((ch) => ch.slice(0, frames))
  return {
    id: uid("ir"),
    name: file.name.replace(/\.[^.]+$/, ""),
    mime: "audio/wav",
    data: bytesToBase64(wav16(trimmed, IR_RATE)),
    width: 0,
    height: 0,
  }
}
