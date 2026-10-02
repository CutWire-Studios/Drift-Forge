import { compile, type CompileResult } from "@/compiler/compile"
import { isParamRef, type CurveKey, type ForgeDoc, type GradientStop, type Literal, type ParamDefault } from "@/doc/types"
import { base64ToBytes } from "@/doc/util"
import { nodeDef } from "@/nodes/registry"
import { AUDIO_SAMPLES, AudioFollower } from "./audio"
import { LOOKUP_WIDTH, lookupPixels } from "./lookup"
import { FrameCanvas, loadMedia, SAMPLES, type LoadedMedia, type MediaItem } from "./media"
import { DriftRenderer, type FrameInput, type UniformValue } from "./renderer"

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5"

export const ASPECTS: Record<Aspect, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 }

export interface EngineStatus {
  playing: boolean
  /** effects: seconds; transitions: 0..1 progress */
  position: number
  duration: number
  fps: number
  error: string | null
  nodeErrors: Record<string, string>
}

interface Thumb {
  canvas: HTMLCanvasElement
  output: string
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, "")
const MAIN_MAX = 960
const THUMB_W = 132
const PRE_HOLD = 0.5
const POST_HOLD = 0.7

/** Everything about a document that changes the generated shader; literal values don't. */
export function structureKey(doc: ForgeDoc): string {
  return JSON.stringify([
    doc.kind,
    doc.nodes.map((n) => [n.id, n.type, n.data, Object.entries(n.inputs).filter(([, v]) => isParamRef(v))]),
    doc.edges.map((e) => [e.from, e.fromSocket, e.to, e.toSocket]),
    doc.params.map((p) => [p.identifier, p.type, !!p.alpha]),
    doc.assets.map((a) => a.id),
  ])
}

/** Resolves sampler parameters (picture, other clip, gradient, curve) to textures. */
function paramTextures(r: DriftRenderer, doc: ForgeDoc, values: Record<string, ParamDefault>) {
  return (id: string): WebGLTexture | null => {
    const p = doc.params.find((q) => q.identifier === id)
    if (!p) return null
    const v = values[id] ?? p.default
    switch (p.type) {
      case "image":
        return r.uprightAsset(String(v))
      case "clip":
        return r.sourceTexture(2)
      case "gradient":
      case "curve":
        return r.dataTexture(`param:${id}`, JSON.stringify(v), () => lookupPixels(p.type as "curve", v as CurveKey[] & GradientStop[]), LOOKUP_WIDTH)
      default:
        return null
    }
  }
}

function literalValue(v: Literal): UniformValue {
  if (typeof v === "boolean") return v ? 1 : 0
  return v as UniformValue
}

/**
 * Drives the live preview: one hidden WebGL2 context renders the main view and every node
 * thumbnail, each copied out to its own 2D canvas.
 */
export class PreviewEngine {
  readonly renderer: DriftRenderer
  private glCanvas = document.createElement("canvas")
  private frameA = new FrameCanvas()
  private frameB = new FrameCanvas()
  private frameC = new FrameCanvas()
  readonly audio = new AudioFollower()
  private main: HTMLCanvasElement | null = null
  private thumbs = new Map<string, Thumb>()
  private thumbCursor = 0

  private doc: ForgeDoc | null = null
  private key = ""
  private compiled: CompileResult | null = null
  private thumbCompiled = new Map<string, CompileResult | null>()
  private literals: Record<string, UniformValue> = {}
  private paramValues: Record<string, ParamDefault> = {}

  /** 0: the clip (effects) / From, 1: To, 2: the "other clip" next-Drift clip parameters sample */
  private media: [LoadedMedia | null, LoadedMedia | null, LoadedMedia | null] = [null, null, null]
  private sourceItems: [MediaItem, MediaItem, MediaItem] = [SAMPLES[0], SAMPLES[1], SAMPLES[4]]
  aspect: Aspect = "16:9"

  private playing = true
  private clock = 0
  private progress = 0
  loopLength = 4
  transitionDuration = 1.5
  private lastTs = 0
  private raf = 0
  private frames = 0
  private fpsStamp = 0
  private status: EngineStatus = { playing: true, position: 0, duration: 4, fps: 0, error: null, nodeErrors: {} }
  private listeners = new Set<(s: EngineStatus) => void>()
  private lastEmit = 0

  constructor() {
    this.renderer = new DriftRenderer(this.glCanvas)
  }

  subscribe(cb: (s: EngineStatus) => void): () => void {
    this.listeners.add(cb)
    cb(this.status)
    return () => this.listeners.delete(cb)
  }

  private emit(force = false) {
    const now = performance.now()
    if (!force && now - this.lastEmit < 100) return
    this.lastEmit = now
    this.status = { ...this.status }
    this.listeners.forEach((l) => l(this.status))
  }

  setMainCanvas(c: HTMLCanvasElement | null) {
    this.main = c
  }

  registerThumb(nodeId: string, output: string, canvas: HTMLCanvasElement | null) {
    if (canvas) this.thumbs.set(nodeId, { canvas, output })
    else this.thumbs.delete(nodeId)
  }

  setDoc(doc: ForgeDoc) {
    this.doc = doc
    const key = structureKey(doc)
    if (key !== this.key) {
      this.key = key
      this.compiled = compile(doc, { mode: "preview" })
      this.thumbCompiled.clear()
      this.status.error = this.compiled.ok ? null : this.compiled.errors.map((e) => e.message).join("\n")
      const nodeErrors: Record<string, string> = {}
      for (const e of this.compiled.errors) if (e.node) nodeErrors[e.node] = e.message
      this.status.nodeErrors = nodeErrors
      this.emit(true)
    }
    for (const a of doc.assets) {
      if (!this.renderer.hasAsset(a.id)) {
        const blob = new Blob([base64ToBytes(a.data) as Uint8Array<ArrayBuffer>], { type: a.mime })
        createImageBitmap(blob).then((bmp) => {
          this.renderer.setAsset(a.id, bmp)
          this.renderer.setUprightAsset(a.id, bmp)
        })
      }
    }
    const lit: Record<string, UniformValue> = {}
    for (const n of doc.nodes) {
      const def = nodeDef(n.type)
      if (!def) continue
      for (const input of def.inputs) {
        const v = n.inputs[input.id] ?? input.default
        if (!isParamRef(v)) lit[`k_${safe(n.id)}_${safe(input.id)}`] = literalValue(v)
      }
    }
    this.literals = lit
    if (this.usesAudio(doc) && !this.audio.item) void this.audio.load(AUDIO_SAMPLES[0]).then(() => {
        if (this.playing) void this.audio.play()
      })
  }

  private usesAudio(doc: ForgeDoc) {
    return doc.nodes.some((n) => n.type === "audio")
  }

  setParamValues(v: Record<string, ParamDefault>) {
    this.paramValues = v
  }

  async setSource(index: 0 | 1 | 2, item: MediaItem) {
    this.sourceItems[index] = item
    const prev = this.media[index]
    const m = await loadMedia(item)
    if (this.sourceItems[index] !== item) return
    if (prev && prev !== m && prev.el instanceof HTMLVideoElement && !this.isUsed(prev)) prev.el.pause()
    this.media[index] = m
    if (m.el instanceof HTMLVideoElement && this.playing) m.el.play().catch(() => {})
  }

  private isUsed(m: LoadedMedia) {
    return this.media.includes(m)
  }

  sources(): [MediaItem, MediaItem, MediaItem] {
    return this.sourceItems
  }

  start() {
    void this.setSource(0, this.sourceItems[0])
    void this.setSource(1, this.sourceItems[1])
    void this.setSource(2, this.sourceItems[2])
    const loop = (ts: number) => {
      this.raf = requestAnimationFrame(loop)
      this.tick(ts)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    for (const m of this.media) if (m?.el instanceof HTMLVideoElement) m.el.pause()
    this.audio.pause()
  }

  setPlaying(p: boolean) {
    this.playing = p
    for (const m of this.media) {
      if (m?.el instanceof HTMLVideoElement) {
        if (p) m.el.play().catch(() => {})
        else m.el.pause()
      }
    }
    if (this.audio.item) {
      if (p) void this.audio.play()
      else this.audio.pause()
    }
    this.status.playing = p
    this.emit(true)
  }

  /** effects: seconds; transitions: progress 0..1 */
  seek(position: number) {
    if (this.doc?.kind === "transition") {
      this.progress = position
      this.clock = PRE_HOLD + position * this.transitionDuration
    } else {
      this.clock = position
      const v = this.effectVideo()
      if (v) v.currentTime = position % Math.max(v.duration || 1, 0.001)
    }
    this.status.position = position
    this.emit(true)
  }

  private effectVideo(): HTMLVideoElement | null {
    const el = this.media[0]?.el
    return el instanceof HTMLVideoElement ? el : null
  }

  frameSize(maxSide = MAIN_MAX): [number, number] {
    const a = ASPECTS[this.aspect]
    return a >= 1 ? [maxSide, Math.round(maxSide / a)] : [Math.round(maxSide * a), maxSide]
  }

  private tick(ts: number) {
    const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.1) : 0
    this.lastTs = ts
    const doc = this.doc
    if (!doc) return

    let time: number
    if (doc.kind === "transition") {
      const cycle = PRE_HOLD + this.transitionDuration + POST_HOLD
      if (this.playing) this.clock = (this.clock + dt) % cycle
      this.progress = Math.min(1, Math.max(0, (this.clock - PRE_HOLD) / this.transitionDuration))
      time = this.clock
      this.status.position = this.progress
      this.status.duration = 1
    } else {
      const v = this.effectVideo()
      if (v && v.duration) {
        time = v.currentTime
        this.status.duration = v.duration
      } else {
        if (this.playing) this.clock = (this.clock + dt) % this.loopLength
        time = this.clock
        this.status.duration = this.loopLength
      }
      this.status.position = time
    }

    const [w, h] = this.frameSize()
    if (this.media[0]) this.renderer.setSource(0, this.frameA.draw(this.media[0], w, h))
    if (doc.kind === "transition" && this.media[1]) this.renderer.setSource(1, this.frameB.draw(this.media[1], w, h))
    if (this.media[2] && doc.params.some((p) => p.type === "clip")) this.renderer.setSource(2, this.frameC.draw(this.media[2], w, h))
    const engineValues = this.audio.sample(ts)
    const textures = paramTextures(this.renderer, doc, this.paramValues)

    const frame = (width: number, height: number): FrameInput => ({
      width,
      height,
      time,
      progress: this.progress,
      params: doc.params,
      paramValues: this.paramValues,
      literals: this.literals,
      engine: engineValues,
      paramTexture: textures,
    })
    const assetOf = (compiled: CompileResult) => (texId: string) =>
      compiled.textures.find((t) => t.id === texId)?.assetId ?? ""

    if (this.compiled?.ok && this.main) {
      const r = this.renderer.render(this.compiled, frame(w, h), assetOf(this.compiled))
      if (typeof r === "string") {
        if (this.status.error !== r) {
          this.status.error = r
          this.emit(true)
        }
      } else {
        if (this.main.width !== w || this.main.height !== h) {
          this.main.width = w
          this.main.height = h
        }
        const g = this.main.getContext("2d")!
        g.drawImage(this.glCanvas, r.sx, r.sy, r.w, r.h, 0, 0, w, h)
      }
    }

    this.renderThumbs(frame, assetOf)

    this.frames++
    if (ts - this.fpsStamp > 1000) {
      this.status.fps = Math.round((this.frames * 1000) / (ts - this.fpsStamp))
      this.frames = 0
      this.fpsStamp = ts
    }
    this.emit()
  }

  private renderThumbs(
    frame: (w: number, h: number) => FrameInput,
    assetOf: (c: CompileResult) => (texId: string) => string,
  ) {
    const doc = this.doc!
    const entries = [...this.thumbs.entries()]
    if (!entries.length) return
    const a = ASPECTS[this.aspect]
    const tw = THUMB_W
    const th = Math.round(THUMB_W / Math.max(a, 0.5))
    const perFrame = Math.min(entries.length, 4)
    for (let i = 0; i < perFrame; i++) {
      const [nodeId, thumb] = entries[(this.thumbCursor + i) % entries.length]
      const node = doc.nodes.find((n) => n.id === nodeId)
      if (!node) continue
      const key = `${nodeId}:${thumb.output}`
      let c = this.thumbCompiled.get(key)
      if (c === undefined) {
        c = compile(doc, { mode: "preview", target: { node: nodeId, output: thumb.output } })
        if (!c.ok) c = null
        this.thumbCompiled.set(key, c)
      }
      const g = thumb.canvas.getContext("2d")!
      if (thumb.canvas.width !== tw || thumb.canvas.height !== th) {
        thumb.canvas.width = tw
        thumb.canvas.height = th
      }
      if (!c) {
        g.clearRect(0, 0, tw, th)
        continue
      }
      const r = this.renderer.render(c, frame(tw, th), assetOf(c))
      if (typeof r !== "string") g.drawImage(this.glCanvas, r.sx, r.sy, r.w, r.h, 0, 0, tw, th)
    }
    this.thumbCursor = (this.thumbCursor + perFrame) % entries.length
  }

  /** Small JPEG of the current main view for the library grid. */
  snapshot(): string | undefined {
    if (!this.main || !this.main.width) return undefined
    const c = document.createElement("canvas")
    c.width = 320
    c.height = Math.round((320 * this.main.height) / this.main.width)
    c.getContext("2d")!.drawImage(this.main, 0, 0, c.width, c.height)
    return c.toDataURL("image/jpeg", 0.75)
  }

  /** Renders the export preview image with the exported (inlined) shader code. */
  renderPackagePreview(doc: ForgeDoc): ImageData | string {
    const compiled = compile(doc, { mode: "export" })
    if (!compiled.ok) return compiled.errors.map((e) => e.message).join("\n")
    const assetOf = (texId: string) => compiled.textures.find((t) => t.id === texId)?.assetId ?? ""
    const base = {
      params: doc.params,
      paramValues: {},
      literals: {},
      paramTexture: paramTextures(this.renderer, doc, {}),
    }
    if (doc.kind === "effect") {
      const size = 256
      if (this.media[0]) this.renderer.setSource(0, this.frameA.draw(this.media[0], size, size))
      return this.renderer.readPixels(
        compiled,
        { ...base, width: size, height: size, time: doc.preview.thumbTime, progress: 0 },
        assetOf,
      )
    }
    const n = 12
    const s = 128
    const strip = new ImageData(s * n, s)
    if (this.media[0]) this.renderer.setSource(0, this.frameA.draw(this.media[0], s, s))
    if (this.media[1]) this.renderer.setSource(1, this.frameB.draw(this.media[1], s, s))
    for (let i = 0; i < n; i++) {
      const img = this.renderer.readPixels(compiled, { ...base, width: s, height: s, time: 0, progress: i / (n - 1) }, assetOf)
      if (typeof img === "string") return img
      for (let y = 0; y < s; y++) strip.data.set(img.data.subarray(y * s * 4, (y + 1) * s * 4), (y * s * n + i * s) * 4)
    }
    return strip
  }
}

/** A still of `doc` on the sample photos, for cards that aren't open in the editor. */
export async function renderCardThumb(doc: ForgeDoc, width = 320, height = 180): Promise<string | null> {
  const e = getEngine()
  const compiled = compile(doc, { mode: "export" })
  if (!compiled.ok) return null
  const [a, b] = await Promise.all([loadMedia(SAMPLES[2]), loadMedia(SAMPLES[6])])
  for (const asset of doc.assets) {
    if (!e.renderer.hasAsset(asset.id)) {
      const blob = new Blob([base64ToBytes(asset.data) as Uint8Array<ArrayBuffer>], { type: asset.mime })
      const bmp = await createImageBitmap(blob)
      e.renderer.setAsset(asset.id, bmp)
      e.renderer.setUprightAsset(asset.id, bmp)
    }
  }
  const fa = new FrameCanvas()
  const fb = new FrameCanvas()
  e.renderer.setSource(0, fa.draw(a, width, height))
  e.renderer.setSource(1, fb.draw(b, width, height))
  const img = e.renderer.readPixels(
    compiled,
    {
      width,
      height,
      time: 0.6,
      progress: 0.5,
      params: doc.params,
      paramValues: {},
      literals: {},
      paramTexture: paramTextures(e.renderer, doc, {}),
    },
    (texId) => compiled.textures.find((t) => t.id === texId)?.assetId ?? "",
  )
  if (typeof img === "string") return null
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  c.getContext("2d")!.putImageData(img, 0, 0)
  return c.toDataURL("image/jpeg", 0.8)
}

let engine: PreviewEngine | null = null

export function getEngine(): PreviewEngine {
  return (engine ??= new PreviewEngine())
}
