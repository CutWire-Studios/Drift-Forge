export const FORGE_SCHEMA = 1

export type Kind = "effect" | "transition"

export type SocketType = "float" | "vec2" | "color"

export type Vec2 = [number, number]
export type Rgba = [number, number, number, number]
export type Literal = number | boolean | Vec2 | Rgba

/** An input bound to one Drift parameter, or two for a vec2 exported to today's Drift (no vec2 type). */
export interface ParamRef {
  param: string | [string, string]
}

export type InputValue = Literal | ParamRef

/** Drift reads float, bool and color today; the rest need the next Drift (docs/drift-next-params.md). */
export type ParamType =
  | "float"
  | "bool"
  | "color"
  | "int"
  | "point"
  | "choice"
  | "seed"
  | "region"
  | "image"
  | "clip"
  | "gradient"
  | "curve"

export const NEXT_PARAM_TYPES: ParamType[] = ["int", "point", "choice", "seed", "region", "image", "clip", "gradient", "curve"]

export interface GradientStop {
  pos: number
  color: Rgba
}

export interface CurveKey {
  x: number
  y: number
  ease: "linear" | "smooth" | "in" | "out" | "hold"
}

export type ParamDefault = number | boolean | string | Vec2 | Rgba | GradientStop[] | CurveKey[]

export interface ParamUi {
  control?: "slider" | "angle" | "seed"
  unit?: string
  step?: number
  precision?: number
}

export interface ParamDef {
  identifier: string
  displayName: string
  type: ParamType
  min: number
  max: number
  /**
   * float/int/seed/choice: number · bool: boolean · color: "#rrggbb" ("#rrggbbaa" with alpha) ·
   * point: [x, y] · region: [x, y, w, h] · image: asset id · clip: "" · gradient/curve: stops/keys
   */
  default: ParamDefault
  group?: string
  /** choice: the labels, bound as the chosen index */
  options?: string[]
  /** color: keep transparency (binds vec4) */
  alpha?: boolean
  /** region: how the inspector draws it */
  shape?: "rect" | "ellipse"
  ui?: ParamUi
  /** only shown in Drift's inspector while this switch is on */
  showWhen?: { param: string; equals: boolean }
}

export interface Preset {
  name: string
  values: Record<string, ParamDefault>
}

export interface ForgeNode {
  id: string
  type: string
  x: number
  y: number
  inputs: Record<string, InputValue>
  data: Record<string, unknown>
}

export interface ForgeEdge {
  id: string
  from: string
  fromSocket: string
  to: string
  toSocket: string
}

export interface ForgeAsset {
  id: string
  name: string
  mime: string
  /** base64, so the document stays plain JSON for IndexedDB, links and forge.json */
  data: string
  width: number
  height: number
}

export interface ForgeMeta {
  id: string
  displayName: string
  category: string
  description: string
  author: string
  version: string
}

export interface ForgeDoc {
  forge: typeof FORGE_SCHEMA
  kind: Kind
  meta: ForgeMeta
  params: ParamDef[]
  nodes: ForgeNode[]
  edges: ForgeEdge[]
  assets: ForgeAsset[]
  presets?: Preset[]
  preview: {
    /** seconds into the clip the effect thumbnail is rendered at */
    thumbTime: number
    /** png data URL of a user-supplied thumbnail, replacing the rendered one */
    customThumb?: string
  }
}

export function isParamRef(v: unknown): v is ParamRef {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "param" in v
}

export const EFFECT_CATEGORIES = ["color", "glitch", "retro", "dreamy", "impact", "artistic", "funny", "blurs"]
export const TRANSITION_CATEGORIES = ["basic", "geometric", "distortion", "liquid", "stylized", "glitch", "cinematic"]
