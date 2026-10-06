// Everything that differs between parameter types, declared once per type. The compiler, the
// manifest writer, the doc edits and the preview read these instead of switching on `type`.
import type { ForgeDoc, Literal, ParamDef, ParamDefOf, ParamType, ParamValues, Rgba } from "./types"
import { hexToRgba, rgbToHex } from "./util"

/** How the preview binds a sampler parameter. */
export type ParamTexture = "asset" | "clip" | "lookup"

export interface ParamTypeSpec<T extends ParamType> {
  glslType(p: ParamDefOf<T>): string
  /** Only the next Drift reads it (docs/drift-next-params.md). */
  next: boolean
  texture?: ParamTexture
  /** The literal an input falls back to when it stops being a slider. */
  literal(p: ParamDefOf<T>): Literal
  /** The value in the shape Drift's JSON uses for this type. */
  driftValue(doc: ForgeDoc, p: ParamDefOf<T>, v: ParamValues[T]): unknown
  /** Type-specific keys of the parameter's manifest entry. */
  manifestFields(p: ParamDefOf<T>): Record<string, unknown>
  /** Whether the manifest carries a defaultValue. */
  exportsDefault: boolean
}

const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/webp": "webp" }
export const mimeExt = (mime: string): string => MIME_EXT[mime] ?? "png"

/** File an image parameter's default picture is written to inside the package. */
export function imageParamFile(doc: ForgeDoc, p: ParamDef): string | null {
  const asset = doc.assets.find((a) => a.id === p.default)
  if (!asset) return null
  return `param_${p.identifier}.${mimeExt(asset.mime)}`
}

const hex8 = (c: Rgba) => rgbToHex(c) + Math.round(Math.min(1, Math.max(0, c[3])) * 255).toString(16).padStart(2, "0")

const range = (p: ParamDef) => ({ minValue: p.min, maxValue: p.max })
const none = () => ({})

const numeric = {
  glslType: () => "float",
  next: false,
  literal: (p: ParamDef) => Number(p.default),
  driftValue: (_: ForgeDoc, __: ParamDef, v: number) => Number(v),
  manifestFields: none,
  exportsDefault: true,
}

const integer = {
  ...numeric,
  next: true,
  driftValue: (_: ForgeDoc, __: ParamDef, v: number) => Math.round(Number(v)),
}

export const PARAM_TYPES: { [T in ParamType]: ParamTypeSpec<T> } = {
  float: { ...numeric, manifestFields: range },
  int: { ...integer, manifestFields: range },
  seed: { ...numeric, next: true },
  choice: { ...integer, manifestFields: (p) => ({ options: p.options ?? [] }) },
  bool: {
    ...numeric,
    literal: (p) => (p.default ? 1 : 0),
    driftValue: (_, __, v) => (v ? 1 : 0),
    manifestFields: () => ({ minValue: 0, maxValue: 1 }),
  },
  color: {
    glslType: (p) => (p.alpha ? "vec4" : "vec3"),
    next: false,
    literal: (p) => hexToRgba(String(p.default)),
    driftValue: (_, p, v) => {
      const s = String(v).toLowerCase()
      if (!p.alpha) return s.slice(0, 7)
      return s.length === 7 ? `${s}ff` : s
    },
    manifestFields: (p): Record<string, unknown> => (p.alpha ? { alpha: true } : {}),
    exportsDefault: true,
  },
  point: {
    glslType: () => "vec2",
    next: true,
    literal: (p) => [p.default[0], p.default[1]],
    driftValue: (_, __, v) => v,
    manifestFields: (p) => ({ minValue: [p.min, p.min], maxValue: [p.max, p.max] }),
    exportsDefault: true,
  },
  region: {
    glslType: () => "vec4",
    next: true,
    literal: (p) => Number(p.default),
    driftValue: (_, __, v) => v,
    manifestFields: (p) => ({ shape: p.shape ?? "rect" }),
    exportsDefault: true,
  },
  image: {
    glslType: () => "sampler2D",
    next: true,
    texture: "asset",
    literal: (p) => Number(p.default),
    driftValue: (doc, p) => imageParamFile(doc, p) ?? "",
    manifestFields: none,
    exportsDefault: true,
  },
  clip: {
    glslType: () => "sampler2D",
    next: true,
    texture: "clip",
    literal: (p) => Number(p.default),
    driftValue: () => "",
    manifestFields: none,
    exportsDefault: false,
  },
  gradient: {
    glslType: () => "sampler2D",
    next: true,
    texture: "lookup",
    literal: (p) => Number(p.default),
    driftValue: (_, __, v) => v.map((s) => ({ position: s.pos, color: hex8(s.color) })),
    manifestFields: none,
    exportsDefault: true,
  },
  curve: {
    glslType: () => "sampler2D",
    next: true,
    texture: "lookup",
    literal: (p) => Number(p.default),
    driftValue: (_, __, v) => v,
    manifestFields: none,
    exportsDefault: true,
  },
}

/**
 * The spec for a parameter, typed loosely enough to call with that same parameter: TypeScript
 * can't correlate `PARAM_TYPES[p.type]` with `p` across the union, so the one cast lives here.
 */
export function paramSpec(p: ParamDef): ParamTypeSpec<ParamType> {
  return PARAM_TYPES[p.type] as unknown as ParamTypeSpec<ParamType>
}

export const isSamplerParam = (p: ParamDef): boolean => paramSpec(p).texture !== undefined
