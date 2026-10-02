import type { CurveKey, GradientStop, Kind, Literal, SocketType } from "@/doc/types"

export type Category =
  | "input"
  | "color"
  | "distort"
  | "three"
  | "blur"
  | "stylize"
  | "generate"
  | "mix"
  | "transition"
  | "animate"
  | "math"
  | "advanced"
  | "output"

export interface InputDef {
  id: string
  label: string
  type: SocketType
  default: Literal
  min?: number
  max?: number
  step?: number
  /** Unconnected, this input follows the clip clock: seconds for effects, progress for transitions. */
  clock?: boolean
  /** angle: degrees dial · point: on-frame position · toggle: on/off · swatch: colour picker ·
   * seed: random seed with shuffle · choice: index into the node's `labels` option */
  widget?: "angle" | "point" | "toggle" | "swatch" | "seed" | "choice"
  /** Counts (slices, levels…): exposed as a whole-number slider. */
  integer?: boolean
  /** Shown after the value in Drift's inspector, e.g. "px". */
  unit?: string
  /** Pixel-space and similar inputs where exposing would confuse; stays a plain literal. */
  noExpose?: boolean
  hint?: string
}

export interface OutputDef {
  id: string
  label: string
  type: SocketType
}

export type CurvePoint = CurveKey

export type OptionDef =
  | { id: string; label: string; kind: "select"; options: { value: string; label: string }[]; default: string }
  | { id: string; label: string; kind: "toggle"; default: boolean }
  | { id: string; label: string; kind: "number"; default: number; min: number; max: number; step?: number }
  | { id: string; label: string; kind: "code"; default: string }
  | { id: string; label: string; kind: "labels"; default: string[] }
  // The kinds below can be exposed to Drift (next Drift only) by storing a ParamRef in node.data.
  | { id: string; label: string; kind: "curve"; default: CurvePoint[] }
  | { id: string; label: string; kind: "gradient"; default: GradientStop[] }
  | { id: string; label: string; kind: "region"; default: [number, number, number, number] }
  | { id: string; label: string; kind: "asset" }

export type HelperName =
  | "hash11"
  | "hash21"
  | "hash22"
  | "valueNoise"
  | "fbm"
  | "over"
  | "luma"
  | "hsv"
  | "rot2"
  | "rot3"
  | "blend"
  | "ease"
  | "invBilinear"
  | "rayQuad"
  | "ycc"

export type EngineUniform = "u_audioLevel" | "u_audioBass" | "u_audioBeat"

export interface EmitCtx {
  kind: Kind
  /** Unique, GLSL-safe prefix for anything the node declares at file scope. */
  prefix: string
  /** Input value as a GLSL expression of the input's own type, evaluated at `uv` (default "uv"). */
  in(id: string, uv?: string): string
  /** True when something is wired into the input. */
  connected(id: string): boolean
  opt<T = unknown>(id: string): T
  /** Uniform name when the option is exposed as a Drift parameter, else null. */
  optParam(id: string): string | null
  helper(name: HelperName): void
  /** u_time for effects, u_progress for transitions. */
  clock(): string
  time(): string
  progress(): string
  res(): string
  source(index: 0 | 1, uv: string): string
  /** Samples the node's image (asset or exposed picture), top row at v=0 either way. */
  asset(uv: string, option?: string): string
  /** Samples the clip chosen in this node's clip parameter (next Drift). */
  clip(uv: string): string
  /** A per-frame engine value only the next Drift provides. */
  engine(name: EngineUniform): string
  /** Declares a file-scope function or constant; text must already use `prefix` for its names. */
  declare(text: string): void
}

export interface StageDef {
  /** Return a function body producing vec4. `prev` samples the previous stage (stage 0: none). */
  body(ctx: EmitCtx, prev: (uv: string) => string): string
}

export interface NodeDef {
  type: string
  label: string
  category: Category
  description: string
  inputs: InputDef[]
  outputs: OutputDef[]
  options?: OptionDef[]
  /** Restricts the node to one document kind. */
  kinds?: Kind[]
  /** Only exports for the next Drift (see ForgeDoc.target). */
  next?: boolean
  /** Cheap to call many times (raw texture reads, constants): never worth a buffer of its own. */
  cheap?: boolean
  /** Inputs sampled many times per pixel. Their upstream is rendered to a buffer first unless cheap. */
  heavyInputs?: string[] | ((ctx: { opt<T = unknown>(id: string): T }) => string[])
  /** Render-to-buffer chain run before this node's own emit; stage 0 may read heavyInputs. */
  stages?: StageDef[]
  /**
   * One function body per output. `stage` samples the last stage's buffer when `stages` is set.
   */
  emit(ctx: EmitCtx, stage: (uv: string) => string): Record<string, string>
  output?: boolean
}
