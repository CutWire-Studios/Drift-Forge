import { zstdCompress, zstdDecompress } from "./zstd"

// The .driftpkg container (drift-addons/packer/driftpkg.py, VideoEd/src/engine/AddonPackage.h)
// with its own magic and no signature trailer: user-made packages can't carry CutWire's key, and
// a distinct magic keeps them from ever being mistaken for official ones. See docs/driftfx-format.md.
export const DRIFTFX_MAGIC = "DRIFTFX\0"
export const DRIFTFX_FORMAT_VERSION = 1
const MAX_RAW = 256 * 1024 * 1024

export interface PackFile {
  path: string
  data: Uint8Array
}

export interface DriftfxManifest {
  schema: 1
  id: string
  version: string
  name: string
  description: string
  details: string
  author: string
  license: string
  minAppVersion: string
  platform: ""
  installedSize: number
  provides: { kind: "effects" | "transitions" | "audio-effects"; root: string; items: number }[]
  files: { path: string; offset: number; size: number; sha256: string }[]
  generator: string
}

export type ManifestBase = Omit<DriftfxManifest, "schema" | "platform" | "installedSize" | "files">

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>))
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("")

/** JSON with keys sorted at every level and no whitespace, like json.dumps(sort_keys=True). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v)
}

export async function writeDriftfx(base: ManifestBase, files: PackFile[]): Promise<Uint8Array> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const table: DriftfxManifest["files"] = []
  let offset = 0
  for (const f of sorted) {
    table.push({ path: f.path, offset, size: f.data.length, sha256: hex(await sha256(f.data)) })
    offset += f.data.length
  }
  const raw = new Uint8Array(offset)
  for (const f of sorted) raw.set(f.data, table.find((t) => t.path === f.path)!.offset)
  const payload = await zstdCompress(raw, 19)

  const manifest: DriftfxManifest = { ...base, schema: 1, platform: "", installedSize: offset, files: table }
  const meta = new TextEncoder().encode(canonicalJson(manifest))

  const bodyLen = 8 + 4 + 4 + meta.length + 8 + 8 + payload.length
  const out = new Uint8Array(bodyLen + 32)
  const view = new DataView(out.buffer)
  out.set(new TextEncoder().encode(DRIFTFX_MAGIC), 0)
  view.setUint32(8, DRIFTFX_FORMAT_VERSION, true)
  view.setUint32(12, meta.length, true)
  out.set(meta, 16)
  let p = 16 + meta.length
  view.setBigUint64(p, BigInt(payload.length), true)
  view.setBigUint64(p + 8, BigInt(offset), true)
  p += 16
  out.set(payload, p)
  out.set(await sha256(out.subarray(0, bodyLen)), bodyLen)
  return out
}

export class DriftfxError extends Error {}

export async function readDriftfx(bytes: Uint8Array): Promise<{ manifest: DriftfxManifest; files: PackFile[] }> {
  const fail = (m: string): never => {
    throw new DriftfxError(m)
  }
  if (bytes.length < 16 + 16 + 32) fail("File is too short to be a .driftfx package.")
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== DRIFTFX_MAGIC) fail("Not a .driftfx package.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint32(8, true)
  if (version !== DRIFTFX_FORMAT_VERSION) fail(`Unsupported .driftfx version ${version}.`)
  const metaLen = view.getUint32(12, true)
  if (16 + metaLen + 16 + 32 > bytes.length) fail("Package header is damaged.")
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + metaLen))) as DriftfxManifest
  let p = 16 + metaLen
  const compLen = Number(view.getBigUint64(p, true))
  const rawLen = Number(view.getBigUint64(p + 8, true))
  p += 16
  if (p + compLen + 32 !== bytes.length) fail("Package size doesn't match its header.")
  if (rawLen > MAX_RAW) fail("Package is too large.")
  const digest = await sha256(bytes.subarray(0, p + compLen))
  if (hex(digest) !== hex(bytes.subarray(p + compLen))) fail("Package is corrupted (checksum mismatch).")

  const raw = await zstdDecompress(bytes.subarray(p, p + compLen))
  if (raw.length !== rawLen) fail("Package payload has the wrong size.")
  const files: PackFile[] = []
  for (const f of manifest.files) {
    if (f.offset + f.size > raw.length) fail(`File ${f.path} is out of bounds.`)
    const data = raw.slice(f.offset, f.offset + f.size)
    if (hex(await sha256(data)) !== f.sha256) fail(`File ${f.path} is corrupted.`)
    files.push({ path: f.path, data })
  }
  return { manifest, files }
}
