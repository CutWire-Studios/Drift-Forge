// Characterization guard for refactors: everything a starter turns into (doc, preview and export
// GLSL, package files, audio graph, share link, .driftfx bytes) must stay byte-identical.
// Random ids are canonicalised so only structure and output are compared.
import { describe, expect, it } from "vitest"
import { exportDriftfx } from "@/core/export/archive"
import { decodeLinkPayload, encodeLinkPayload, linkDoc } from "@/core/export/link"
import { readDriftfx } from "@/core/export/driftfx"
import { packageFiles } from "@/core/export/package"
import { graphJson } from "@/core/audio/rack"
import { compile } from "@/core/compiler/compile"
import type { ForgeDoc } from "@/core/doc/types"
import { STARTERS } from "@/core/starters"
import { AUDIO_STARTERS } from "@/core/starters/audio"

function collectIds(v: unknown, out: string[]) {
  if (Array.isArray(v)) for (const x of v) collectIds(x, out)
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if ((k === "id" || k === "from" || k === "to" || k === "item") && typeof x === "string") out.push(x)
      collectIds(x, out)
    }
}

function canonicaliser(doc: ForgeDoc): (s: string) => string {
  const ids: string[] = []
  collectIds(doc, ids)
  const unique = [...new Set(ids)].filter((id) => id.length >= 4)
  const names = new Map(unique.map((id, i) => [id, `#${i}`]))
  const sorted = [...unique].sort((a, b) => b.length - a.length)
  return (s) => sorted.reduce((acc, id) => acc.replaceAll(id, names.get(id)!), s)
}

const irs = { get: () => new Uint8Array([1, 2, 3]) } as unknown as Map<string, Uint8Array>

describe("starter outputs are unchanged", () => {
  for (const s of [...STARTERS, ...AUDIO_STARTERS]) {
    it(s.name, async () => {
      const doc = s.doc
      const c = canonicaliser(doc)
      const dec = new TextDecoder()
      const preview = compile(doc, { mode: "preview" })
      const { files } = packageFiles(doc, { png: new Uint8Array([137, 80, 78, 71]), irs })
      const out = {
        doc: c(JSON.stringify(doc, null, 1)),
        preview: c(JSON.stringify(preview, null, 1)),
        files: files.map((f) => ({ path: c(f.path), text: c(dec.decode(f.data)) })),
        graph: doc.kind === "audio" ? c(JSON.stringify(graphJson(doc), null, 1)) : null,
      }
      expect(out).toMatchSnapshot()
      expect(await decodeLinkPayload(await encodeLinkPayload(doc))).toEqual(linkDoc(doc))
      const { manifest } = await readDriftfx(await exportDriftfx(doc, { png: null, irs }))
      const unhashed = { ...manifest, files: manifest.files.map(({ sha256: _, ...f }) => f) }
      expect(c(JSON.stringify(unhashed, null, 1))).toMatchSnapshot()
    })
  }
})
