// The live preview of an audio document: Drift's own DSP (compiled to wasm) in an AudioWorklet,
// fed a looping sample, a file of the user's own or the microphone.
//
// The graph is rebuilt only when its shape changes (rackSignature). Moving a knob that isn't a
// slider, or a slider's try-out value, is pushed into the running graph instead, so reverb and
// delay tails keep ringing while you tweak.
import { allItems, rackOf, rackSignature } from "@/audio/rack"
import { modulatorSpec, pedalSpec } from "@/audio/pedals"
import { audioPackageJson } from "@/compiler/manifest"
import { isParamRef, isSplit, type ForgeDoc, type KnobValue, type ParamDefault } from "@/doc/types"
import type { FromWorklet, ToWorklet } from "./messages"
import workletUrl from "./worklet.ts?worker&url"

export type SourceId = "beat" | "music" | "file" | "mic"

export const SAMPLE_SOURCES: { id: SourceId; label: string; url?: string }[] = [
  { id: "beat", label: "Drum loop", url: "/samples/beat-120.mp3" },
  { id: "music", label: "Chords", url: "/samples/audio/chords.mp3" },
]

export interface Meters {
  /** peakL, peakR, rmsL, rmsR, then a short scope, for each rack item by id */
  taps: Map<string, Float32Array>
  input: Float32Array | null
  output: Float32Array | null
  /** modulator outputs by id: LFOs -1..1, envelopes and steps 0..1 */
  mods: Map<string, number>
  /** seconds into the loop, or -1 for the microphone */
  position: number
}

export interface PreviewState {
  ready: boolean
  playing: boolean
  abBypass: boolean
  source: SourceId
  sourceName: string
  duration: number
  error: string | null
}

const numeric = (v: ParamDefault | KnobValue): number => (typeof v === "boolean" ? (v ? 1 : 0) : Number(v))

/** Every fixed value the running graph can take without a rebuild, keyed so changes can be diffed. */
function liveValues(doc: ForgeDoc): Map<string, ToWorklet> {
  const out = new Map<string, ToWorklet>()
  const rack = rackOf(doc)
  for (const item of allItems(rack)) {
    if (isSplit(item)) {
      if (item.blend !== undefined && !isParamRef(item.blend)) out.set(`${item.id}/0`, { type: "knob", node: item.id, knob: 0, value: numeric(item.blend) })
      item.crossovers?.forEach((c, i) => {
        if (!isParamRef(c)) out.set(`${item.id}/${i + 1}`, { type: "knob", node: item.id, knob: i + 1, value: numeric(c) })
      })
      continue
    }
    const spec = pedalSpec(item.type)
    spec?.knobs.forEach((k, i) => {
      const v = item.knobs[k.id]
      if (v !== undefined && !isParamRef(v)) out.set(`${item.id}/${i}`, { type: "knob", node: item.id, knob: i, value: numeric(v) })
    })
    if (!isParamRef(item.bypass)) out.set(`${item.id}/bypass`, { type: "bypassNode", node: item.id, on: !!item.bypass })
  }
  for (const m of rack.modulators) {
    modulatorSpec(m.type)?.knobs.forEach((k, i) => {
      const v = m.knobs[k.id]
      if (v !== undefined && !isParamRef(v)) out.set(`${m.id}/${i}`, { type: "modKnob", mod: m.id, knob: i, value: numeric(v) })
    })
    m.steps?.forEach((v, i) => out.set(`${m.id}/step${i}`, { type: "step", mod: m.id, step: i, value: v }))
  }
  return out
}

function same(a: ToWorklet, b: ToWorklet): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

class AudioPreview {
  private ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private starting: Promise<void> | null = null
  private mic: MediaStreamAudioSourceNode | null = null
  private micStream: MediaStream | null = null
  private generation = 0
  private ids: string[] = []
  private modIds: string[] = []
  private signature = ""
  private live = new Map<string, ToWorklet>()
  private params = new Map<string, number>()
  private doc: ForgeDoc | null = null
  private paramValues: Record<string, ParamDefault> = {}
  private decoded = new Map<string, AudioBuffer>()
  private meterListeners = new Set<(m: Meters) => void>()
  private stateListeners = new Set<() => void>()
  state: PreviewState = { ready: false, playing: false, abBypass: false, source: "beat", sourceName: "Drum loop", duration: 0, error: null }

  onMeters(fn: (m: Meters) => void): () => void {
    this.meterListeners.add(fn)
    return () => this.meterListeners.delete(fn)
  }

  onState(fn: () => void): () => void {
    this.stateListeners.add(fn)
    return () => this.stateListeners.delete(fn)
  }

  private patch(p: Partial<PreviewState>) {
    this.state = { ...this.state, ...p }
    for (const fn of this.stateListeners) fn()
  }

  private post(m: ToWorklet, transfer: Transferable[] = []) {
    this.node?.port.postMessage(m, transfer)
  }

  /** Audio can only start from a user gesture, so this runs on the first press of Play. */
  private start(): Promise<void> {
    this.starting ??= (async () => {
      const ctx = new AudioContext({ latencyHint: "interactive" })
      const [module] = await Promise.all([WebAssembly.compileStreaming(fetch("/audio/drift-audio.wasm")), ctx.audioWorklet.addModule(workletUrl)])
      const node = new AudioWorkletNode(ctx, "drift-graph", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { module },
      })
      node.connect(ctx.destination)
      await new Promise<void>((resolve, reject) => {
        node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
          if (e.data.type === "ready") resolve()
          else if (e.data.type === "error") reject(new Error(e.data.message))
        }
      })
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.receive(e.data)
      this.ctx = ctx
      this.node = node
      this.signature = ""
      this.patch({ ready: true })
      if (this.doc) this.setDoc(this.doc)
      await this.setSource(this.state.source)
    })().catch((err: Error) => {
      this.starting = null
      this.patch({ error: `The preview can't start: ${err.message}` })
    })
    return this.starting
  }

  private receive(m: FromWorklet) {
    if (m.type === "graphError" && m.generation === this.generation) this.patch({ error: m.message })
    else if (m.type === "graphReady" && m.generation === this.generation) this.patch({ error: null })
    else if (m.type === "meters" && m.generation === this.generation) {
      const taps = new Map<string, Float32Array>()
      const slot = (i: number) => m.taps.subarray(i * m.stride, (i + 1) * m.stride)
      this.ids.forEach((id, i) => taps.set(id, slot(i)))
      const mods = new Map<string, number>()
      this.modIds.forEach((id, i) => mods.set(id, m.mods[i] ?? 0))
      const meters: Meters = { taps, input: slot(this.ids.length), output: slot(this.ids.length + 1), mods, position: m.position }
      for (const fn of this.meterListeners) fn(meters)
    }
  }

  private paramValue(id: string): number | undefined {
    const p = this.doc?.params.find((q) => q.identifier === id)
    if (!p) return undefined
    return numeric(this.paramValues[id] ?? (p.default as ParamDefault))
  }

  /** Follows the document: a new graph when its shape changed, live edits when only values did. */
  setDoc(doc: ForgeDoc) {
    this.doc = doc
    if (!this.node) return
    const signature = rackSignature(doc)
    const live = liveValues(doc)
    if (signature !== this.signature) {
      this.signature = signature
      this.live = live
      this.generation++
      const rack = rackOf(doc)
      this.ids = allItems(rack).map((i) => i.id)
      this.modIds = rack.modulators.map((m) => m.id)
      this.params = new Map(doc.params.map((p) => [p.identifier, this.paramValue(p.identifier) ?? 0]))
      this.post({
        type: "graph",
        generation: this.generation,
        manifest: JSON.stringify(audioPackageJson(doc)),
        files: [],
        params: Object.fromEntries(this.params),
      })
      return
    }
    for (const [key, m] of live) {
      const was = this.live.get(key)
      if (!was || !same(was, m)) this.post(m)
    }
    this.live = live
    this.syncParams()
  }

  /** The Sliders tab's try-out values (they aren't saved; Drift users set them per clip). */
  setParamValues(values: Record<string, ParamDefault>) {
    this.paramValues = values
    this.syncParams()
  }

  private syncParams() {
    if (!this.doc) return
    for (const p of this.doc.params) {
      const v = this.paramValue(p.identifier)
      if (v === undefined || this.params.get(p.identifier) === v) continue
      this.params.set(p.identifier, v)
      this.post({ type: "param", id: p.identifier, value: v })
    }
  }

  async play() {
    await this.start()
    if (!this.ctx) return
    await this.ctx.resume()
    this.post({ type: "transport", playing: true })
    this.patch({ playing: true })
  }

  pause() {
    this.post({ type: "transport", playing: false })
    this.patch({ playing: false })
  }

  restart() {
    this.post({ type: "transport", playing: this.state.playing, restart: true })
  }

  setAbBypass(on: boolean) {
    this.post({ type: "abBypass", on })
    this.patch({ abBypass: on })
  }

  private stopMic() {
    this.mic?.disconnect()
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.mic = null
    this.micStream = null
  }

  private sendBuffer(buffer: AudioBuffer) {
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice())
    this.post({ type: "source", channels }, channels.map((c) => c.buffer))
    this.patch({ duration: buffer.duration })
  }

  /** A bundled sample, the microphone, or (with `file`) audio of the user's own. */
  async setSource(id: SourceId, file?: File) {
    if (!this.ctx) {
      this.patch({ source: id, sourceName: file?.name ?? SAMPLE_SOURCES.find((s) => s.id === id)?.label ?? "" })
      if (file) this.pendingFile = file
      return
    }
    const ctx = this.ctx
    this.stopMic()
    try {
      if (id === "mic") {
        // Echo cancellation and noise suppression would fight the effects being auditioned.
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        this.mic = ctx.createMediaStreamSource(this.micStream)
        this.mic.connect(this.node!)
        this.post({ type: "source", channels: null })
        this.patch({ source: id, sourceName: "Microphone", duration: 0, error: null })
        return
      }
      const pick = file ?? (id === "file" ? this.pendingFile : undefined)
      let buffer: AudioBuffer | undefined
      if (pick) {
        buffer = await ctx.decodeAudioData(await pick.arrayBuffer())
        this.pendingFile = pick
      } else {
        const url = SAMPLE_SOURCES.find((s) => s.id === id)?.url
        if (!url) return
        buffer = this.decoded.get(url)
        if (!buffer) {
          buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
          this.decoded.set(url, buffer)
        }
      }
      this.sendBuffer(buffer)
      this.patch({ source: id, sourceName: pick?.name ?? SAMPLE_SOURCES.find((s) => s.id === id)!.label, error: null })
    } catch (err) {
      this.patch({ error: id === "mic" ? "The microphone isn't available." : `Couldn't play that audio: ${(err as Error).message}` })
    }
  }

  private pendingFile: File | undefined
}

export const audioPreview = new AudioPreview()
