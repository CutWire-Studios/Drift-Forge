// Writes the golden tests' fixed inputs: input.f32 (an exponential chirp with noise bursts,
// interleaved stereo float32) and ir/room.wav (a decaying-noise impulse response at 48 kHz, so the
// convolution also resamples). Deterministic; rerun only to change the fixtures.
import { mkdirSync, writeFileSync } from "node:fs"

const dir = new URL("../src/__tests__/golden/", import.meta.url)
const RATE = 32000
const FRAMES = 16000

let seed = 0x2545f491
const noise = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) / 4294967296) * 2 - 1
}

const input = new Float32Array(FRAMES * 2)
let phase = 0
for (let i = 0; i < FRAMES; i++) {
  const t = i / RATE
  phase += (2 * Math.PI * 80 * Math.pow(100, t / (FRAMES / RATE))) / RATE
  const burst = Math.floor(t * 8) % 2 === 1 ? 0.25 * noise() : 0
  const x = 0.4 * Math.sin(phase) + burst
  input[i * 2] = x
  input[i * 2 + 1] = 0.7 * x + 0.1 * noise()
}
writeFileSync(new URL("input.f32", dir), Buffer.from(input.buffer))

const IR_RATE = 48000
const IR_FRAMES = IR_RATE * 0.3
const pcm = Buffer.alloc(IR_FRAMES * 4)
for (let i = 0; i < IR_FRAMES; i++) {
  const env = Math.exp((-7 * i) / IR_FRAMES)
  pcm.writeInt16LE(Math.round(env * noise() * 30000), i * 4)
  pcm.writeInt16LE(Math.round(env * noise() * 30000), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write("RIFF", 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write("WAVEfmt ", 8)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(IR_RATE, 24)
header.writeUInt32LE(IR_RATE * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write("data", 36)
header.writeUInt32LE(pcm.length, 40)
mkdirSync(new URL("ir/", dir), { recursive: true })
writeFileSync(new URL("ir/room.wav", dir), Buffer.concat([header, pcm]))
