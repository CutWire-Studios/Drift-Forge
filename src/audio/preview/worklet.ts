// The preview's audio thread: Drift's audio graph (compiled to wasm) running in an AudioWorklet.
// Built by Vite as its own module (AudioPreview imports it with ?worker&url).
import { loadDriftAudio, stageFile, WasmGraph, type DriftAudioModule } from "../wasm/graph"
import type { ToWorklet } from "./messages"

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

// Emscripten's clock reads performance.now(), which not every engine provides inside a worklet.
const g = globalThis as { performance?: { now(): number } }
g.performance ??= { now: () => Date.now() }

const QUANTUM = 128
// Meters at about 30 a second.
const METER_EVERY = Math.round(sampleRate / 30 / QUANTUM)

class DriftGraphProcessor extends AudioWorkletProcessor {
  private M: DriftAudioModule | null = null
  private graph: WasmGraph | null = null
  private generation = 0
  private params = new Map<string, number>()
  private source: Float32Array[] | null = null
  private live = false
  private position = 0
  private playing = false
  private bypass = false
  private quanta = 0
  private readonly io = new Float32Array(QUANTUM * 2)
  private readonly dry = new Float32Array(QUANTUM * 2)
  private pending: ToWorklet[] = []

  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super()
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => (this.M ? this.handle(e.data) : this.pending.push(e.data))
    loadDriftAudio(options.processorOptions.module).then(
      (M) => {
        this.M = M
        for (const m of this.pending.splice(0)) this.handle(m)
        this.port.postMessage({ type: "ready" })
      },
      (err: unknown) => this.port.postMessage({ type: "error", message: String(err) }),
    )
  }

  private handle(m: ToWorklet) {
    const M = this.M!
    switch (m.type) {
      case "graph": {
        for (const f of m.files) stageFile(M, f.path, f.data)
        this.graph?.destroy()
        this.graph = null
        this.generation = m.generation
        try {
          this.graph = WasmGraph.create(M, m.manifest, sampleRate)
        } catch (err) {
          this.port.postMessage({ type: "graphError", generation: m.generation, message: (err as Error).message })
          return
        }
        M._dg_clear_files()
        this.params = new Map(Object.entries(m.params))
        for (const [id, v] of this.params) this.graph.setParam(this.graph.paramIndex(id), v)
        this.graph.enableTaps(true)
        // LFO and step phases follow the source's own clock, the way Drift's follow the clip's.
        this.graph.reset(this.position / sampleRate)
        this.port.postMessage({ type: "graphReady", generation: m.generation, latency: this.graph.latency })
        break
      }
      case "param":
        this.params.set(m.id, m.value)
        this.graph?.setParam(this.graph.paramIndex(m.id), m.value)
        break
      case "knob":
        if (this.graph) this.graph.setKnob(this.graph.nodeIndex(m.node), m.knob, m.value)
        break
      case "bypassNode":
        if (this.graph) this.graph.setBypass(this.graph.nodeIndex(m.node), m.on)
        break
      case "routeDepth":
        if (this.graph) this.graph.setRouteDepth(this.graph.nodeIndex(m.node), m.knob, this.graph.modulatorIndex(m.mod), m.value)
        break
      case "laneGain":
        if (this.graph) this.graph.setLaneGain(this.graph.nodeIndex(m.node), m.lane, m.value)
        break
      case "modKnob":
        if (this.graph) this.graph.setModulatorKnob(this.graph.modulatorIndex(m.mod), m.knob, m.value)
        break
      case "step":
        if (this.graph) this.graph.setModulatorStep(this.graph.modulatorIndex(m.mod), m.step, m.value)
        break
      case "source":
        this.source = m.channels
        this.live = m.channels === null
        this.position = m.keepPosition && m.channels ? this.position % m.channels[0].length : 0
        break
      case "transport":
        this.playing = m.playing
        if (m.restart) {
          this.position = 0
          this.graph?.reset(0)
        }
        break
      case "abBypass":
        this.bypass = m.on
        break
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] ?? out[0]
    if (!this.playing || (!this.live && !this.source)) {
      left.fill(0)
      right.fill(0)
      return true
    }

    const n = left.length
    const io = this.io
    if (this.live) {
      const inL = inputs[0]?.[0]
      const inR = inputs[0]?.[1] ?? inL
      for (let i = 0; i < n; i++) {
        io[i * 2] = inL ? inL[i] : 0
        io[i * 2 + 1] = inR ? inR[i] : 0
      }
    } else {
      const src = this.source!
      const sl = src[0]
      const sr = src[1] ?? sl
      const len = sl.length
      for (let i = 0; i < n; i++) {
        io[i * 2] = sl[this.position]
        io[i * 2 + 1] = sr[this.position]
        // The loop plays straight on: tails carry across the seam, as they would in music.
        if (++this.position >= len) this.position = 0
      }
    }

    // A/B compares against the untouched input, but the graph keeps running so B→A is seamless.
    this.dry.set(io)
    const frame = io.subarray(0, n * 2)
    if (this.graph) this.graph.process(frame)
    const heard = this.bypass ? this.dry : io
    for (let i = 0; i < n; i++) {
      left[i] = heard[i * 2]
      right[i] = heard[i * 2 + 1]
    }

    if (this.graph && ++this.quanta >= METER_EVERY) {
      this.quanta = 0
      const taps = this.graph.collectTaps()
      this.port.postMessage({
        type: "meters",
        generation: this.generation,
        stride: taps.stride,
        taps: taps.data,
        mods: this.graph.modulatorValues(),
        position: this.live ? -1 : this.position / sampleRate,
      })
    }
    return true
  }
}

registerProcessor("drift-graph", DriftGraphProcessor)
