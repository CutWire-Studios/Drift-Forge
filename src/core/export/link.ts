import { KIND_INFO } from "@/core/doc/kinds"
import { migrateLegacyAudio } from "@/core/audio/processors"
import { FORGE_SCHEMA, type ForgeDoc } from "@/core/doc/types"
import { zstdCompress, zstdDecompress } from "./zstd"

/** Past ~16 KB, chat apps and some browsers start truncating or refusing links. */
export const LINK_LIMIT = 16 * 1024
export const LINK_PREFIX = "v1."

export class LinkError extends Error {}

function toBase64Url(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/")
  const s = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** What goes into a link: the document minus anything Forge can regenerate on open. */
export function linkDoc(doc: ForgeDoc): ForgeDoc {
  const d = structuredClone(doc)
  delete d.preview.customThumb
  for (const n of d.nodes) {
    n.x = Math.round(n.x)
    n.y = Math.round(n.y)
  }
  return d
}

/** The URL fragment payload (without "#"). Assets should already be shrunk by the caller. */
export async function encodeLinkPayload(doc: ForgeDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(linkDoc(doc)))
  return LINK_PREFIX + toBase64Url(await zstdCompress(json, 19))
}

export async function decodeLinkPayload(payload: string): Promise<ForgeDoc> {
  if (!payload.startsWith(LINK_PREFIX)) throw new LinkError("This link isn't a Drift Forge share link.")
  let json: Uint8Array
  try {
    json = await zstdDecompress(fromBase64Url(payload.slice(LINK_PREFIX.length)))
  } catch {
    throw new LinkError("This link is damaged or incomplete. It may have been cut off when it was shared.")
  }
  return parseForgeDoc(new TextDecoder().decode(json))
}

/** Parses and sanity-checks a ForgeDoc from forge.json, a link or storage. */
export function parseForgeDoc(text: string): ForgeDoc {
  let d: ForgeDoc
  try {
    d = JSON.parse(text)
  } catch {
    throw new LinkError("The file isn't valid JSON.")
  }
  if (!d || typeof d !== "object" || d.forge === undefined) throw new LinkError("This isn't a Drift Forge document.")
  if (d.forge > FORGE_SCHEMA) throw new LinkError("This was made with a newer Drift Forge. Reload the page to update.")
  if (!Object.hasOwn(KIND_INFO, d.kind)) throw new LinkError("Unknown document kind.")
  if (!Array.isArray(d.nodes) || !Array.isArray(d.edges) || !Array.isArray(d.params) || !d.meta) {
    throw new LinkError("The document is incomplete.")
  }
  d.assets ??= []
  d.preview ??= { thumbTime: 0.5 }
  if (d.kind === "audio") {
    migrateLegacyAudio(d)
    d.audio ??= { rack: { chain: [], modulators: [], routes: [] } }
  }
  d.forge = FORGE_SCHEMA
  return d
}
