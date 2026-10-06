export const FORGE_SCHEMA = 2

export type Kind = "effect" | "transition" | "audio"

export type SocketType = "float" | "vec2" | "color"

export type Vec2 = [number, number]
export type Rgba = [number, number, number, number]
export type Literal = number | boolean | Vec2 | Rgba

/** An input bound to one Drift parameter, or two for a vec2 exported to today's Drift (no vec2 type). */
export interface ParamRef {
  param: string | [string, string]
}

export type InputValue = Literal | ParamRef

export interface GradientStop {
  pos: number
  color: Rgba
}

export interface CurveKey {
  x: number
  y: number
  ease: "linear" | "smooth" | "in" | "out" | "hold"
}

/**
 * Each parameter type with the shape of its value. Drift reads float, bool and color today; the
 * rest need the next Drift (docs/drift-next-params.md).
 */
export interface ParamValues {
  float: number
  bool: boolean
  /** "#rrggbb" ("#rrggbbaa" with alpha) */
  color: string
  int: number
  point: Vec2
  /** bound as the chosen index */
  choice: number
  seed: number
  /** [x, y, w, h] */
  region: [number, number, number, number]
  /** asset id */
  image: string
  /** always "": Drift binds the clip picked on the timeline */
  clip: string
  gradient: GradientStop[]
  curve: CurveKey[]
}

export type ParamType = keyof ParamValues

export type ParamDefault = ParamValues[ParamType]

export interface ParamUi {
  control?: "slider" | "angle" | "seed"
  unit?: string
  step?: number
  precision?: number
}

interface ParamBase {
  identifier: string
  displayName: string
  min: number
  max: number
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

export type ParamDefOf<T extends ParamType> = ParamBase & { type: T; default: ParamValues[T] }

export type ParamDef = { [T in ParamType]: ParamDefOf<T> }[ParamType]

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
  /** images; 0 for audio */
  width: number
  height: number
}

/** A pedal or modulator control: a fixed value, or bound to one of the document's sliders. */
export type KnobValue = number | boolean | { param: string }

/** One of Drift's compiled-in pedals (src/audio/pedals.json); knobs are keyed by the catalog's ids. */
export interface Pedal {
  id: string
  type: string
  knobs: Record<string, KnobValue>
  /** on (truthy) passes the audio through untouched */
  bypass?: KnobValue
  /** convolution: "builtin:<name>" or the id of an audio asset */
  ir?: string
}

export interface SplitLane {
  id: string
  gain: number
  chain: RackItem[]
}

/** Runs its lanes side by side and sums them: the same input in each, or one frequency band each. */
export interface SplitBlock {
  id: string
  type: "split"
  mode: "parallel" | "bands"
  /** parallel, two lanes: equal-power blend between them instead of a sum */
  crossfade?: boolean
  blend?: KnobValue
  /** bands: one frequency per boundary, ascending */
  crossovers?: KnobValue[]
  lanes: SplitLane[]
}

export type RackItem = Pedal | SplitBlock

export interface Modulator {
  id: string
  type: "lfo" | "envelope" | "steps"
  knobs: Record<string, KnobValue>
  /** steps: one value per step, 0..1 */
  steps?: number[]
  /** envelope: "input", or the id of the pedal or split whose output it follows */
  source?: string
}

/** A modulator moving a pedal knob; depth is a fraction of the knob's range, -1..1. */
export interface ModRoute {
  id: string
  from: string
  to: string
  knob: string
  depth: KnobValue
}

/** One instrument in the audio preview's step sequencer. */
export interface SequencerRow {
  id: string
  /** an id from audio/preview/instruments */
  instrument: string
  /** 16 sixteenth-note steps */
  steps: boolean[]
  volume: number
  /** -1 (left) .. 1 (right) */
  pan: number
  muted: boolean
}

/** What an audio effect is auditioned on. Only for the editor; never exported to Drift. */
export interface PreviewInput {
  mode: "pattern" | "audio"
  bpm: number
  rows: SequencerRow[]
  /** in "audio" mode: which included recording plays (a file of the user's own isn't saved) */
  audio: string
}

export interface AudioRack {
  chain: RackItem[]
  modulators: Modulator[]
  routes: ModRoute[]
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
  /** audio effects: the pedalboard Drift runs as an audio graph (no node graph) */
  audio?: { rack: AudioRack }
  preview: {
    /** seconds into the clip the effect thumbnail is rendered at */
    thumbTime: number
    /** png data URL of a user-supplied thumbnail, replacing the rendered one */
    customThumb?: string
    /** Sample clip the editor previews on when the document opens (runtime/media SAMPLES id) */
    clip?: string
    /** audio effects: the step pattern or recording the preview plays */
    input?: PreviewInput
  }
}

export function isSplit(item: RackItem): item is SplitBlock {
  return item.type === "split"
}

export function isParamRef(v: unknown): v is ParamRef {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "param" in v
}
