import { FORGE_SCHEMA, type ForgeDoc, type Kind, type Rgba } from "./types"

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 8)
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "untitled"
  )
}

/** Drift scans roots in order and the first id wins, so a random tail keeps user effects from
 * shadowing (or being shadowed by) a built-in with the same name. */
export function makeEffectId(name: string): string {
  return `forge_${slugify(name)}_${Math.random().toString(36).slice(2, 6)}`
}

const DEFAULT_NAME: Record<Kind, string> = { effect: "My effect", transition: "My transition", audio: "My audio effect" }
const DEFAULT_CATEGORY: Record<Kind, string> = { effect: "artistic", transition: "basic", audio: "space" }

export function emptyDoc(kind: Kind, name = DEFAULT_NAME[kind]): ForgeDoc {
  return {
    forge: FORGE_SCHEMA,
    kind,
    meta: {
      id: makeEffectId(name),
      displayName: name,
      category: DEFAULT_CATEGORY[kind],
      description: "",
      author: "",
      version: "1.0.0",
    },
    params: [],
    nodes: [],
    edges: [],
    assets: [],
    ...(kind === "audio" ? { audio: { rack: { chain: [], modulators: [], routes: [] } } } : {}),
    preview: { thumbTime: 0.5 },
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgba(hex)
  return [r, g, b]
}

/** "#rrggbb" or "#rrggbbaa" → 0..1 RGBA. */
export function hexToRgba(hex: string): Rgba {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return [0, 0, 0, 1]
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1]
}

export function rgbaToHex(c: readonly number[]): string {
  return rgbToHex(c) + Math.round(Math.min(1, Math.max(0, c[3] ?? 1)) * 255).toString(16).padStart(2, "0")
}

export function rgbToHex(c: readonly number[]): string {
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

export function rgbaFromHex(hex: string): Rgba {
  const [r, g, b] = hexToRgb(hex)
  return [r, g, b, 1]
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
