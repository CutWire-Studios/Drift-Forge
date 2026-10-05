// Writes the built-in impulse responses in public/audio/ir: synthetic, so they carry no third-party
// material. 48 kHz stereo 16-bit WAV, deterministic; rerun only to change them.
import { writeFileSync } from "node:fs"

const SR = 48000

function noise(seed) {
  let s = seed >>> 0
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

/** Decaying noise whose highs die faster than its lows, like air and soft walls absorb them. */
function tail(seconds, rt60, { brightStart, brightEnd, build, seed }) {
  const n = Math.round(seconds * SR)
  const out = new Float32Array(n)
  const rnd = noise(seed)
  let y = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const fc = brightEnd + (brightStart - brightEnd) * Math.exp(-t / (rt60 / 3))
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
    y += a * (rnd() - y)
    out[i] = y * Math.exp((-6.91 * t) / rt60) * (1 - Math.exp(-t / build))
  }
  return out
}

function addReflections(buf, taps, seed) {
  const rnd = noise(seed)
  for (const [ms, gain] of taps) {
    const i = Math.round((ms / 1000) * SR)
    if (i < buf.length) buf[i] += gain * (rnd() > 0 ? 1 : -1)
  }
}

function delay(buf, ms) {
  const d = Math.round((ms / 1000) * SR)
  const out = new Float32Array(buf.length + d)
  out.set(buf, d)
  return out
}

/** A spring tank: each bounce along the spring is smeared into a chirp by dispersion. */
function spring(seed) {
  const n = Math.round(1.6 * SR)
  const out = new Float32Array(n)
  const period = Math.round(0.033 * SR)
  for (let i = 0; i < n; i += period) out[i] = Math.exp((-6.91 * (i / SR)) / 1.4) * (i === 0 ? 1 : 0.8)
  // A long chain of first-order allpasses: high frequencies arrive first, the classic "boing".
  for (let stage = 0; stage < 120; stage++) {
    const c = 0.62
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < n; i++) {
      const x = out[i]
      const y = -c * x + x1 + c * y1
      x1 = x
      y1 = y
      out[i] = y
    }
  }
  // Springs only carry a band; add a little diffuse hiss so it isn't a pure chirp train.
  const rnd = noise(seed)
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const x = out[i] + 0.04 * rnd() * Math.exp((-6.91 * t) / 1.2)
    lo += 0.35 * (x - lo)
    hi += 0.02 * (lo - hi)
    out[i] = lo - hi
  }
  return out
}

function wav(left, right) {
  const n = Math.min(left.length, right.length)
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  const g = 0.9 / peak
  const data = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(left[i] * g * 32767), i * 4)
    data.writeInt16LE(Math.round(right[i] * g * 32767), i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write("RIFF", 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write("WAVEfmt ", 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(16, 34)
  h.write("data", 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const dir = new URL("../public/audio/ir/", import.meta.url)

const room = (seed) => {
  const t = tail(0.7, 0.45, { brightStart: 9000, brightEnd: 2200, build: 0.004, seed })
  addReflections(t, [[3, 0.9], [7, 0.6], [11, 0.5], [16, 0.45], [23, 0.35], [31, 0.3], [38, 0.22]], seed + 1)
  return delay(t, 2)
}
const hall = (seed) => {
  const t = tail(3.0, 2.6, { brightStart: 8000, brightEnd: 1200, build: 0.06, seed })
  addReflections(t, [[0, 0.5], [21, 0.35], [34, 0.3], [47, 0.28], [62, 0.25], [79, 0.22], [95, 0.2], [112, 0.17]], seed + 1)
  return delay(t, 24)
}
const plate = (seed) => tail(2.2, 1.9, { brightStart: 15000, brightEnd: 5000, build: 0.003, seed })

writeFileSync(new URL("room.wav", dir), wav(room(11), room(29)))
writeFileSync(new URL("hall.wav", dir), wav(hall(41), hall(73)))
writeFileSync(new URL("plate.wav", dir), wav(plate(5), plate(91)))
writeFileSync(new URL("spring.wav", dir), wav(spring(17), delay(spring(53), 0.7)))
