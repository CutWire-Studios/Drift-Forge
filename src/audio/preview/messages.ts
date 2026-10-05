// What the preview's main thread and its AudioWorklet say to each other.

export type ToWorklet =
  | { type: "graph"; generation: number; manifest: string; files: { path: string; data: Uint8Array }[]; params: Record<string, number> }
  | { type: "param"; id: string; value: number }
  | { type: "knob"; node: string; knob: number; value: number }
  | { type: "bypassNode"; node: string; on: boolean }
  /** knob: index in the pedal's catalog knobs */
  | { type: "routeDepth"; node: string; knob: number; mod: string; value: number }
  | { type: "laneGain"; node: string; lane: number; value: number }
  | { type: "modKnob"; mod: string; knob: number; value: number }
  | { type: "step"; mod: string; step: number; value: number }
  /**
   * Decoded audio to loop, or null to process the node's input (the microphone). With keepPosition
   * the loop carries on from where it was: a re-rendered pattern must not restart the bar.
   */
  | { type: "source"; channels: Float32Array[] | null; keepPosition?: boolean }
  | { type: "transport"; playing: boolean; restart?: boolean }
  /** A/B: hear the input untouched while the graph keeps running */
  | { type: "abBypass"; on: boolean }

export type FromWorklet =
  | { type: "ready" }
  | { type: "error"; message: string }
  | { type: "graphError"; generation: number; message: string }
  | { type: "graphReady"; generation: number; latency: number }
  | { type: "meters"; generation: number; stride: number; taps: Float32Array; mods: Float32Array; position: number }
