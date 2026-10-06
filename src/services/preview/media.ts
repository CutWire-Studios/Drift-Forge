export type PatternKind = "grid" | "bars" | "gradient" | "checker"

export interface MediaItem {
  id: string
  label: string
  kind: "image" | "video" | "pattern"
  url?: string
  pattern?: PatternKind
  /** Id of the sample holding this clip's person matte (white person on black). */
  matte?: string
  /** User uploads stay as object URLs in this tab only. */
  user?: boolean
}

const photo = (id: string, label: string): MediaItem => ({ id, label, kind: "image", url: `/samples/${id}.jpg` })
const person = (id: string, label: string): MediaItem[] => [
  { id, label: `${label} (clip)`, kind: "video", url: `/samples/${id}.mp4`, matte: `${id}-matte` },
  { id: `${id}-matte`, label: `${label} (matte)`, kind: "video", url: `/samples/${id}-matte.mp4` },
]

export const SAMPLES: MediaItem[] = [
  { id: "mountains-push", label: "Mountains (clip)", kind: "video", url: "/samples/mountains-push.mp4" },
  { id: "city-pan", label: "City at night (clip)", kind: "video", url: "/samples/city-pan.mp4" },
  ...person("dancer", "Dancer"),
  ...person("flower-portrait", "Woman with a flower"),
  ...person("stage-model", "Model on stage"),
  ...person("park-walk", "Walk in the park"),
  photo("landscape", "Lake"),
  photo("portrait", "Portrait"),
  photo("neon", "Neon sign"),
  photo("tulips", "Tulips"),
  photo("city-night", "Bridge at night"),
  photo("cyclist", "Cyclist"),
  photo("macaw", "Parrot"),
  photo("vintage-car", "Vintage car"),
  { id: "grid", label: "Test grid", kind: "pattern", pattern: "grid" },
  { id: "bars", label: "Colour bars", kind: "pattern", pattern: "bars" },
  { id: "gradient", label: "Gradient", kind: "pattern", pattern: "gradient" },
  { id: "checker", label: "Checker", kind: "pattern", pattern: "checker" },
]

export const sample = (id: string) => SAMPLES.find((m) => m.id === id)!

export type MediaElement = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

export interface LoadedMedia {
  item: MediaItem
  el: MediaElement
  width: number
  height: number
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void

const PATTERNS: Record<PatternKind, Painter> = {
  bars: (g, w, h) => {
    const cols = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"]
    cols.forEach((col, i) => {
      g.fillStyle = col
      g.fillRect((i * w) / cols.length, 0, w / cols.length + 1, h * 0.7)
    })
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, "#000")
    grad.addColorStop(1, "#fff")
    g.fillStyle = grad
    g.fillRect(0, h * 0.7, w, h * 0.3)
  },
  gradient: (g, w, h) => {
    for (let x = 0; x < w; x += 4) {
      const grad = g.createLinearGradient(0, 0, 0, h)
      const hue = (x / w) * 360
      grad.addColorStop(0, `hsl(${hue} 100% 95%)`)
      grad.addColorStop(0.5, `hsl(${hue} 100% 50%)`)
      grad.addColorStop(1, `hsl(${hue} 100% 5%)`)
      g.fillStyle = grad
      g.fillRect(x, 0, 4, h)
    }
  },
  checker: (g, w, h) => {
    const s = 80
    for (let y = 0; y < h; y += s)
      for (let x = 0; x < w; x += s) {
        g.fillStyle = (x / s + y / s) % 2 ? "#f4f4f5" : "#18181b"
        g.fillRect(x, y, s, s)
      }
  },
  grid: (g, w, h) => {
    g.fillStyle = "#18181c"
    g.fillRect(0, 0, w, h)
    g.strokeStyle = "#3f3f4a"
    g.lineWidth = 1
    for (let x = 0; x <= w; x += 40) {
      g.beginPath()
      g.moveTo(x + 0.5, 0)
      g.lineTo(x + 0.5, h)
      g.stroke()
    }
    for (let y = 0; y <= h; y += 40) {
      g.beginPath()
      g.moveTo(0, y + 0.5)
      g.lineTo(w, y + 0.5)
      g.stroke()
    }
    g.strokeStyle = "#ffc107"
    g.lineWidth = 3
    g.beginPath()
    g.arc(w / 2, h / 2, h * 0.35, 0, Math.PI * 2)
    g.stroke()
    g.font = "600 44px Inter Variable, sans-serif"
    g.fillStyle = "#f4f4f5"
    g.textAlign = "center"
    g.fillText("TOP", w / 2, 60)
    g.fillText("BOTTOM", w / 2, h - 30)
    g.textAlign = "left"
    g.fillText("LEFT", 24, h / 2 + 15)
    g.textAlign = "right"
    g.fillText("RIGHT", w - 24, h / 2 + 15)
    const corners: [string, number, number][] = [
      ["#ef4444", 0, 0],
      ["#22c55e", w - 60, 0],
      ["#3b82f6", 0, h - 60],
      ["#ffc107", w - 60, h - 60],
    ]
    for (const [col, x, y] of corners) {
      g.fillStyle = col
      g.fillRect(x, y, 60, 60)
    }
  },
}

function drawPattern(kind: PatternKind): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = 1280
  c.height = 720
  PATTERNS[kind](c.getContext("2d")!, c.width, c.height)
  return c
}

const cache = new Map<string, Promise<LoadedMedia>>()

export function loadMedia(item: MediaItem): Promise<LoadedMedia> {
  const hit = cache.get(item.id)
  if (hit) return hit
  const p = new Promise<LoadedMedia>((resolve, reject) => {
    if (item.kind === "pattern") {
      const el = drawPattern(item.pattern!)
      resolve({ item, el, width: el.width, height: el.height })
    } else if (item.kind === "image") {
      const el = new Image()
      el.onload = () => resolve({ item, el, width: el.naturalWidth, height: el.naturalHeight })
      el.onerror = () => reject(new Error(`Couldn't load ${item.label}`))
      el.src = item.url!
    } else {
      const el = document.createElement("video")
      el.muted = true
      el.loop = true
      el.playsInline = true
      el.preload = "auto"
      el.onloadeddata = () => resolve({ item, el, width: el.videoWidth, height: el.videoHeight })
      el.onerror = () => reject(new Error(`Couldn't load ${item.label}`))
      el.src = item.url!
    }
  })
  cache.set(item.id, p)
  p.catch(() => cache.delete(item.id))
  return p
}

export function userMedia(file: File): MediaItem {
  return {
    id: `user-${Date.now()}`,
    label: file.name,
    kind: file.type.startsWith("video/") ? "video" : "image",
    url: URL.createObjectURL(file),
    user: true,
  }
}

/** Draws media into a reusable 2D canvas, cropped to fill the frame (object-fit: cover). */
export class FrameCanvas {
  readonly canvas = document.createElement("canvas")
  private ctx = this.canvas.getContext("2d", { willReadFrequently: false })!

  draw(media: LoadedMedia, width: number, height: number): HTMLCanvasElement {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const s = Math.max(width / media.width, height / media.height)
    const dw = media.width * s
    const dh = media.height * s
    this.ctx.clearRect(0, 0, width, height)
    this.ctx.drawImage(media.el, (width - dw) / 2, (height - dh) / 2, dw, dh)
    return this.canvas
  }
}
