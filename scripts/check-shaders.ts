// Compiles every node (in a minimal graph) and every starter, then validates each generated pass
// with glslangValidator both as desktop `#version 330 core` and after Drift's ES 3.00 translation.
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compile } from "@/compiler/compile"
import { esSource } from "@/runtime/translate"
import type { ForgeDoc, Kind, ParamDef } from "@/doc/types"
import { emptyDoc } from "@/doc/util"
import { availableFor, createNode, NODE_DEFS, outputType } from "@/nodes/registry"
import { STARTERS } from "@/starters"

const dir = mkdtempSync(join(tmpdir(), "forge-glsl-"))
let failures = 0
let checked = 0

function validateGlsl(label: string, source: string) {
  for (const [variant, text] of [
    ["330", source],
    ["es300", esSource(source)],
  ] as const) {
    const file = join(dir, `${checked++}.frag`)
    writeFileSync(file, text)
    try {
      execFileSync("glslangValidator", [file], { stdio: "pipe" })
    } catch (e) {
      failures++
      const out = (e as { stdout?: Buffer }).stdout?.toString() ?? String(e)
      console.error(`FAIL ${label} [${variant}]\n${out}\n${text}`)
    }
  }
}

function checkDoc(label: string, doc: ForgeDoc) {
  for (const mode of ["export", "preview"] as const) {
    const r = compile(doc, { mode })
    if (!r.ok) {
      failures++
      console.error(`FAIL ${label} (${mode}): ${r.errors.map((e) => e.message).join("; ")}`)
      continue
    }
    for (const p of r.passes) validateGlsl(`${label} ${mode} ${p.file}`, p.source)
  }
}

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

for (const kind of ["effect", "transition"] as Kind[]) {
  for (const def of NODE_DEFS) {
    if (def.output || !availableFor(def, kind)) continue
    const doc = emptyDoc(kind)
    if (def.type === "other_clip") {
      doc.params.push({ identifier: "otherClip", displayName: "Other clip", type: "clip", min: 0, max: 1, default: "" })
    }
    doc.assets.push({ id: "a1", name: "px.png", mime: "image/png", data: PIXEL, width: 1, height: 1 })
    const src = createNode(kind === "effect" ? "video" : "from", 0, 0)
    const node = createNode(def.type, 200, 0)
    node.data.asset = "a1"
    if (def.type === "other_clip") node.data.clip = { param: "otherClip" }
    const out = createNode(outputType(kind), 400, 0)
    doc.nodes.push(src, node, out)
    const colorIn = def.inputs.find((i) => i.type === "color")
    if (colorIn) doc.edges.push({ id: "e1", from: src.id, fromSocket: "image", to: node.id, toSocket: colorIn.id })
    // Every output gets its own graph so each emitted body is compiled at least once.
    for (const o of def.outputs) {
      doc.edges = doc.edges.filter((e) => e.to !== out.id)
      doc.edges.push({ id: "e2", from: node.id, fromSocket: o.id, to: out.id, toSocket: "image" })
      checkDoc(`${kind}/${def.type}.${o.id}`, structuredClone(doc))
    }
  }
}

// Every parameter type, exposed at once.
{
  const doc = emptyDoc("effect")
  doc.assets.push({ id: "a1", name: "px.png", mime: "image/png", data: PIXEL, width: 1, height: 1 })
  const P = (identifier: string, type: ParamDef["type"], def: ParamDef["default"], extra: Partial<ParamDef> = {}): ParamDef => ({
    identifier,
    displayName: identifier,
    type,
    min: 0,
    max: 1,
    default: def,
    ...extra,
  })
  doc.params.push(
    P("centre", "point", [0.5, 0.5]),
    P("slices", "int", 6, { max: 16 }),
    P("shuffle", "seed", 3, { max: 1000 }),
    P("tint", "color", "#ff000080", { alpha: true }),
    P("area", "region", [0.2, 0.2, 0.5, 0.5]),
    P("picture", "image", "a1"),
    P("ramp", "gradient", [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }]),
    P("motion", "curve", [{ x: 0, y: 0, ease: "smooth" }, { x: 1, y: 1, ease: "linear" }]),
    P("style", "choice", 1, { options: ["A", "B", "C"] }),
  )
  const v = createNode("video", 0, 0)
  const k = createNode("kaleidoscope", 0, 0)
  k.inputs.center = { param: "centre" }
  k.inputs.segments = { param: "slices" }
  const tint = createNode("tint", 0, 0)
  tint.inputs.color = { param: "tint" }
  const img = createNode("image", 0, 0)
  img.data.asset = { param: "picture" }
  const ramp = createNode("gradient_ramp", 0, 0)
  ramp.data.stops = { param: "ramp" }
  const curve = createNode("curve", 0, 0)
  curve.data.points = { param: "motion" }
  const region = createNode("region", 0, 0)
  region.data.rect = { param: "area" }
  const grain = createNode("grain", 0, 0)
  grain.inputs.seed = { param: "shuffle" }
  const pick = createNode("pick", 0, 0)
  pick.inputs.which = { param: "style" }
  const mix = createNode("mix", 0, 0)
  const out = createNode("effect_output", 0, 0)
  doc.nodes.push(v, k, tint, img, ramp, curve, region, grain, pick, mix, out)
  const e = (from: string, fs: string, to: string, ts: string) => doc.edges.push({ id: `${from}${ts}`, from, fromSocket: fs, to, toSocket: ts })
  e(v.id, "image", k.id, "image")
  e(k.id, "image", tint.id, "image")
  e(tint.id, "image", ramp.id, "image")
  e(curve.id, "value", ramp.id, "amount")
  e(ramp.id, "image", grain.id, "image")
  e(grain.id, "image", pick.id, "a")
  e(img.id, "image", pick.id, "b")
  e(pick.id, "image", mix.id, "a")
  e(v.id, "image", mix.id, "b")
  e(region.id, "mask", mix.id, "amount")
  e(mix.id, "image", out.id, "image")
  checkDoc("next/all-param-types", doc)
}

for (const s of STARTERS) checkDoc(`starter/${s.doc.kind}/${s.name}`, s.doc)

console.log(`${checked} shader variants checked, ${failures} failures`)
process.exit(failures ? 1 : 0)
