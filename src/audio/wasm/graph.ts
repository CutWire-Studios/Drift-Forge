// A thin binding over Drift's audio graph C API. The preview's AudioWorklet and the golden tests
// both drive the DSP through this, so neither touches raw pointers.
import createDriftAudio, { type DriftAudioModule } from "./drift-audio.mjs"

export type { DriftAudioModule }

/** Instantiates the module from an already compiled WebAssembly.Module — the only way in from an
 *  AudioWorklet, which cannot fetch, and the same path in Node. */
export function loadDriftAudio(module: WebAssembly.Module): Promise<DriftAudioModule> {
  return createDriftAudio({
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(module, imports).then((instance) => done(instance, module))
      return {}
    },
  })
}

function withString<T>(M: DriftAudioModule, text: string, fn: (ptr: number) => T): T {
  const size = M.lengthBytesUTF8(text) + 1
  const ptr = M._malloc(size)
  try {
    M.stringToUTF8(text, ptr, size)
    return fn(ptr)
  } finally {
    M._free(ptr)
  }
}

/** Makes a file a manifest refers to ("ir": "ir/plate.wav") available to the next create(). */
export function stageFile(M: DriftAudioModule, path: string, data: Uint8Array): void {
  const ptr = M._malloc(data.length)
  M.HEAPU8.set(data, ptr)
  withString(M, path, (p) => M._dg_stage_file(p, ptr, data.length))
  M._free(ptr)
}

export function pedalCatalogJson(M: DriftAudioModule): string {
  return M.UTF8ToString(M._dg_pedal_catalog())
}

export class WasmGraph {
  readonly capacity: number

  private constructor(
    private readonly M: DriftAudioModule,
    private ptr: number,
  ) {
    this.capacity = M._dg_io_capacity()
  }

  /** Throws with Drift's own reason when the manifest does not validate. */
  static create(M: DriftAudioModule, manifestJson: string, sampleRate: number): WasmGraph {
    const ptr = withString(M, manifestJson, (p) => M._dg_create(p, sampleRate))
    if (!ptr) throw new Error(M.UTF8ToString(M._dg_last_error()))
    return new WasmGraph(M, ptr)
  }

  destroy(): void {
    if (this.ptr) this.M._dg_destroy(this.ptr)
    this.ptr = 0
  }

  paramIndex(identifier: string): number {
    return withString(this.M, identifier, (p) => this.M._dg_param_index(this.ptr, p))
  }
  setParam(index: number, value: number): void {
    this.M._dg_set_param(this.ptr, index, value)
  }
  nodeIndex(id: string): number {
    return withString(this.M, id, (p) => this.M._dg_node_index(this.ptr, p))
  }
  setKnob(node: number, knob: number, value: number): void {
    this.M._dg_set_knob(this.ptr, node, knob, value)
  }
  modulatorIndex(id: string): number {
    return withString(this.M, id, (p) => this.M._dg_modulator_index(this.ptr, p))
  }
  setModulatorKnob(modulator: number, knob: number, value: number): void {
    this.M._dg_set_modulator_knob(this.ptr, modulator, knob, value)
  }
  setModulatorStep(modulator: number, step: number, value: number): void {
    this.M._dg_set_modulator_step(this.ptr, modulator, step, value)
  }
  modulatorValues(): Float32Array {
    const count = this.M._dg_modulator_count(this.ptr)
    const at = this.M._dg_modulator_values(this.ptr) >> 2
    return this.M.HEAPF32.slice(at, at + count)
  }

  reset(clipSeconds = 0): void {
    this.M._dg_reset(this.ptr, clipSeconds)
  }
  get latency(): number {
    return this.M._dg_latency(this.ptr)
  }
  get primeFrames(): number {
    return this.M._dg_prime_frames(this.ptr)
  }

  /** Interleaved stereo, in place. HEAPF32 is re-read on every call: memory growth replaces it. */
  process(interleaved: Float32Array): void {
    const frames = interleaved.length / 2
    for (let offset = 0; offset < frames; offset += this.capacity) {
      const count = Math.min(this.capacity, frames - offset)
      const io = this.M._dg_io(this.ptr) >> 2
      this.M.HEAPF32.set(interleaved.subarray(offset * 2, (offset + count) * 2), io)
      this.M._dg_process(this.ptr, count)
      interleaved.set(this.M.HEAPF32.subarray(io, io + count * 2), offset * 2)
    }
  }

  enableTaps(enabled: boolean): void {
    this.M._dg_enable_taps(this.ptr, enabled ? 1 : 0)
  }
  /** Per slot (nodes in flat order, then input, then output): peakL, peakR, rmsL, rmsR, scope… */
  collectTaps(): { stride: number; data: Float32Array } {
    const stride = this.M._dg_tap_stride()
    const slots = this.M._dg_tap_slots(this.ptr)
    const at = this.M._dg_collect_taps(this.ptr) >> 2
    return { stride, data: this.M.HEAPF32.slice(at, at + stride * slots) }
  }
}
