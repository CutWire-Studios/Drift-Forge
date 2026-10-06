// Impulse responses in the browser: the built-in ones fetched from public/audio/ir (once each), and
// recordings of the user's own decoded into an asset.
import { IR_RATE, irFiles, MAX_IR_SECONDS } from "@/core/audio/irs"
import type { ForgeAsset, ForgeDoc } from "@/core/doc/types"
import { bytesToBase64, uid } from "@/core/doc/util"

const builtinCache = new Map<string, Promise<Uint8Array>>()

export async function fetchBuiltinIr(name: string): Promise<Uint8Array> {
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
export const loadIrFiles = (doc: ForgeDoc): Promise<Map<string, Uint8Array>> => irFiles(doc, fetchBuiltinIr)

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
