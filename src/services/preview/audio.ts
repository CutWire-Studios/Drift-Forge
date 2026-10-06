export interface AudioItem {
  id: string
  label: string
  url: string
  user?: boolean
}

export const AUDIO_SAMPLES: AudioItem[] = [{ id: "beat", label: "Beat loop (120 BPM)", url: "/samples/beat-120.mp3" }]

/**
 * Stand-in for what the next Drift would feed u_audioLevel / u_audioBass / u_audioBeat from the
 * timeline's audio: smoothed loudness, low-end energy, and a pulse that jumps to 1 on a bass hit
 * and decays over ~250 ms. Values are all 0..1.
 */
export class AudioFollower {
  private ctx: AudioContext | null = null
  private el: HTMLAudioElement | null = null
  private analyser: AnalyserNode | null = null
  private gain: GainNode | null = null
  private wave = new Float32Array(1024)
  private freq = new Uint8Array(512)
  private level = 0
  private bass = 0
  private beat = 0
  private bassAvg = 0
  private lastHit = 0
  item: AudioItem | null = null
  audible = false

  async load(item: AudioItem) {
    this.item = item
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 1024
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this.audible ? 1 : 0
      this.analyser.connect(this.gain).connect(this.ctx.destination)
    }
    this.el?.pause()
    const el = new Audio()
    el.crossOrigin = "anonymous"
    el.loop = true
    el.src = item.url
    this.ctx.createMediaElementSource(el).connect(this.analyser!)
    this.el = el
  }

  setAudible(on: boolean) {
    this.audible = on
    if (this.gain) this.gain.gain.value = on ? 1 : 0
  }

  async play() {
    if (!this.el || !this.ctx) return
    await this.ctx.resume()
    await this.el.play().catch(() => {})
  }

  pause() {
    this.el?.pause()
  }

  get active(): boolean {
    return !!this.el && !this.el.paused
  }

  sample(now: number): { u_audioLevel: number; u_audioBass: number; u_audioBeat: number } {
    const a = this.analyser
    if (a && this.active) {
      a.getFloatTimeDomainData(this.wave)
      let sum = 0
      for (const v of this.wave) sum += v * v
      const rms = Math.min(1, Math.sqrt(sum / this.wave.length) * 3)
      this.level += (rms - this.level) * 0.3
      a.getByteFrequencyData(this.freq)
      // Bins under ~150 Hz at 44.1/48 kHz with a 1024-point FFT.
      let low = 0
      for (let i = 1; i < 4; i++) low += this.freq[i]
      const bassNow = low / (3 * 255)
      this.bass += (bassNow - this.bass) * 0.4
      this.bassAvg += (bassNow - this.bassAvg) * 0.02
      if (bassNow > this.bassAvg * 1.25 + 0.05 && now - this.lastHit > 180) {
        this.beat = 1
        this.lastHit = now
      }
    } else {
      this.level *= 0.9
      this.bass *= 0.9
    }
    this.beat *= 0.86
    return { u_audioLevel: this.level, u_audioBass: this.bass, u_audioBeat: this.beat }
  }
}
