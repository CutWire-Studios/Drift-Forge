// Types for Emscripten's loader (drift-audio.mjs), which scripts/build-audio-wasm.sh copies in from
// Drift's wasm/ build. The functions are Drift's C API, src/engine/audio/DriftGraphApi.h.

export interface DriftAudioModule {
  HEAPF32: Float32Array
  HEAPU8: Uint8Array
  UTF8ToString(ptr: number): string
  stringToUTF8(text: string, ptr: number, maxBytes: number): void
  lengthBytesUTF8(text: string): number
  _malloc(bytes: number): number
  _free(ptr: number): void

  _dg_stage_file(path: number, data: number, size: number): void
  _dg_clear_files(): void
  _dg_create(manifestJson: number, sampleRate: number): number
  _dg_last_error(): number
  _dg_destroy(graph: number): void
  _dg_param_index(graph: number, identifier: number): number
  _dg_set_param(graph: number, index: number, value: number): void
  _dg_node_index(graph: number, nodeId: number): number
  _dg_set_knob(graph: number, node: number, knob: number, value: number): void
  _dg_modulator_index(graph: number, modulatorId: number): number
  _dg_modulator_count(graph: number): number
  _dg_set_modulator_knob(graph: number, modulator: number, knob: number, value: number): void
  _dg_set_modulator_step(graph: number, modulator: number, step: number, value: number): void
  _dg_modulator_values(graph: number): number
  _dg_reset(graph: number, clipSeconds: number): void
  _dg_latency(graph: number): number
  _dg_prime_frames(graph: number): number
  _dg_io(graph: number): number
  _dg_io_capacity(): number
  _dg_process(graph: number, frames: number): void
  _dg_enable_taps(graph: number, enabled: number): void
  _dg_tap_slots(graph: number): number
  _dg_tap_stride(): number
  _dg_collect_taps(graph: number): number
  _dg_pedal_catalog(): number
}

export interface DriftAudioOptions {
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => object
}

export default function createDriftAudio(options?: DriftAudioOptions): Promise<DriftAudioModule>
