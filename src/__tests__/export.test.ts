import { describe, expect, it } from "vitest"
import { unzipSync } from "fflate"
import { exportDriftfx, exportZip, importFile } from "@/export/archive"
import { DRIFTFX_MAGIC, readDriftfx, writeDriftfx } from "@/export/driftfx"
import { decodeLinkPayload, encodeLinkPayload, linkDoc } from "@/export/link"
import { STARTERS } from "@/starters"

const glow = STARTERS.find((s) => s.name === "Dreamy glow")!.doc
const wipe = STARTERS.find((s) => s.name === "Glowing wipe")!.doc
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

describe(".driftfx", () => {
  it("round-trips files byte for byte", async () => {
    const files = [
      { path: "effects/x/main.frag", data: new TextEncoder().encode("void main(){}") },
      { path: "effects/x/effect.json", data: new TextEncoder().encode("{}") },
    ]
    const base = {
      id: "user.x", version: "1.0.0", name: "X", description: "", details: "", author: "", license: "",
      minAppVersion: "0.7.0", provides: [{ kind: "effects" as const, root: "effects", items: 1 }], generator: "t",
    }
    const bytes = await writeDriftfx(base, files)
    const { manifest, files: out } = await readDriftfx(bytes)
    // path-sorted, contiguous offsets, like driftpkg.py
    expect(manifest.files.map((f) => [f.path, f.offset])).toEqual([
      ["effects/x/effect.json", 0],
      ["effects/x/main.frag", 2],
    ])
    expect(manifest.installedSize).toBe(15)
    expect(out.find((f) => f.path.endsWith("main.frag"))!.data).toEqual(files[0].data)
  })

  it("has the DRIFTPKG layout with its own magic and a SHA-256 trailer", async () => {
    const bytes = await exportDriftfx(glow, { png })
    expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe(DRIFTFX_MAGIC)
    const view = new DataView(bytes.buffer, bytes.byteOffset)
    expect(view.getUint32(8, true)).toBe(1)
    const metaLen = view.getUint32(12, true)
    const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + metaLen)))
    expect(Object.keys(meta)).toEqual([...Object.keys(meta)].sort())
    expect(meta.provides).toEqual([{ items: 1, kind: "effects", root: "effects" }])
    const compLen = Number(view.getBigUint64(16 + metaLen, true))
    expect(16 + metaLen + 16 + compLen + 32).toBe(bytes.length)
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.subarray(0, bytes.length - 32) as Uint8Array<ArrayBuffer>))
    expect(digest).toEqual(bytes.subarray(bytes.length - 32))
  })

  it("rejects a tampered package", async () => {
    const bytes = await exportDriftfx(glow, { png })
    bytes[bytes.length - 40] ^= 0xff
    await expect(readDriftfx(bytes)).rejects.toThrow(/corrupted|damaged|size/)
  })

  it("re-opens in Forge", async () => {
    const doc = await importFile("glow.driftfx", await exportDriftfx(glow, { png }))
    expect(doc).toEqual(glow)
  })
})

describe("zip", () => {
  it("lays out a Drift package folder and re-opens", async () => {
    const zip = exportZip(wipe, { png })
    const names = Object.keys(unzipSync(zip)).sort()
    expect(names).toEqual(
      ["INSTALL.txt", ...["forge.json", "main.frag", "preview_strip.png", "transition.json"].map((f) => `${wipe.meta.id}/${f}`)].sort(),
    )
    expect(await importFile("x.zip", zip)).toEqual(wipe)
  })
})

describe("link", () => {
  it("round-trips a document", async () => {
    const payload = await encodeLinkPayload(wipe)
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
    expect(await decodeLinkPayload(payload)).toEqual(linkDoc(wipe))
  })

  it("keeps starter links short", async () => {
    for (const s of STARTERS) expect((await encodeLinkPayload(s.doc)).length).toBeLessThan(4000)
  })

  it("explains a truncated link", async () => {
    const payload = await encodeLinkPayload(wipe)
    await expect(decodeLinkPayload(payload.slice(0, payload.length / 2))).rejects.toThrow(/damaged/)
  })
})
