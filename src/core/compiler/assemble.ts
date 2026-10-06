import { isSamplerParam, mimeExt, paramSpec } from "@/core/doc/params"
import type { ForgeDoc, Kind } from "@/core/doc/types"
import { glslType } from "@/core/glsl/literals"
import { resolveHelpers } from "./helpers"
import { samplerName, type CompiledPass, type CompiledTexture, type CompileResult, type LiteralUniform, type PassBuild, type PassInput, type TexRef } from "./passes"

function allocateBuffers(order: PassBuild[]): { physOf: Map<string, string>; count: number } {
  const lastUse = new Map<string, number>()
  order.forEach((p, i) => {
    for (const s of p.samplers) if (s.kind === "buffer") lastUse.set(s.sym, Math.max(lastUse.get(s.sym) ?? -1, i))
  })
  const physOf = new Map<string, string>()
  const holder: string[] = []
  order.forEach((p, i) => {
    if (!p.writes) return
    const reads = new Set(p.samplers.flatMap((s) => (s.kind === "buffer" ? [physOf.get(s.sym)] : [])))
    let slot = holder.findIndex((sym, b) => (lastUse.get(sym) ?? -1) < i && !reads.has(`buf${b}`))
    if (slot < 0) {
      holder.push(p.writes)
      slot = holder.length - 1
    } else holder[slot] = p.writes
    physOf.set(p.writes, `buf${slot}`)
  })
  return { physOf, count: holder.length }
}

/** Lays the built passes out as files, sharing buffers between passes that are never alive at once. */
export function assemble(doc: ForgeDoc, order: PassBuild[], flags: { usesTime: boolean; usesMask: boolean }): CompileResult {
  const { physOf, count } = allocateBuffers(order)

  const textures: CompiledTexture[] = []
  const texId = (assetId: string) => {
    let t = textures.find((t) => t.assetId === assetId)
    if (!t) {
      const asset = doc.assets.find((a) => a.id === assetId)!
      t = { id: `tex${textures.length}`, assetId, file: `tex${textures.length}.${mimeExt(asset.mime)}` }
      textures.push(t)
    }
    return t.id
  }

  const literals = new Map<string, LiteralUniform>()
  const multi = order.length > 1
  const passes: CompiledPass[] = order.map((p, i) => {
    if (p.samplers.length === 0) p.samplers.push({ kind: "source", index: 0 })
    for (const [k, v] of p.literals) literals.set(k, v)
    const inputs = p.samplers.map((s) => passInput(doc.kind, s, physOf, texId))
    return {
      file: !multi || p.key === "root" ? "main.frag" : `pass${i + 1}.frag`,
      source: passSource(doc, p),
      inputs,
      output: p.writes ? { type: "buffer", id: physOf.get(p.writes)! } : { type: "canvas" },
      paramSamplers: doc.params
        .filter((d) => p.params.has(d.identifier) && isSamplerParam(d))
        .map((d) => d.identifier),
    }
  })

  return {
    ok: true,
    errors: [],
    passes,
    buffers: Array.from({ length: count }, (_, i) => `buf${i}`),
    textures,
    literals: [...literals.values()],
    usesTime: flags.usesTime,
    usesMask: flags.usesMask,
  }
}

function passInput(kind: Kind, s: TexRef, physOf: Map<string, string>, texId: (assetId: string) => string): PassInput {
  switch (s.kind) {
    case "source":
      return kind === "transition" ? { type: "source_texture", index: s.index } : { type: "source_texture" }
    case "buffer":
      return { type: "buffer", id: physOf.get(s.sym)! }
    case "asset":
      return { type: "texture", id: texId(s.assetId) }
  }
}

function passSource(doc: ForgeDoc, p: PassBuild): string {
  const lines = ["#version 330 core", "in vec2 v_texCoord;", "out vec4 fragColor;", ""]
  p.samplers.forEach((_, i) => lines.push(`uniform sampler2D ${samplerName(i)};`))
  if (p.usesRes) lines.push("uniform vec2 u_resolution;")
  if (p.usesTime) lines.push("uniform float u_time;")
  if (p.usesProgress) lines.push("uniform float u_progress;")
  for (const e of p.engines) lines.push(`uniform float ${e};`)
  const used = doc.params.filter((d) => p.params.has(d.identifier))
  for (const def of used) lines.push(`uniform ${paramSpec(def).glslType(def)} ${def.identifier};`)
  for (const def of used) {
    const t = paramSpec(def).glslType(def)
    if (t !== "sampler2D") lines.push(`${t} pv_${def.identifier}() { return ${def.identifier}; }`)
  }
  for (const l of p.literals.values()) lines.push(`uniform ${glslType(l.type)} ${l.name};`)
  lines.push("")
  if ([...p.functions, p.main].some((f) => f.includes("luma("))) p.helpers.add("luma")
  for (const h of resolveHelpers(p.helpers)) lines.push(h, "")
  for (const f of p.functions) lines.push(f, "")
  lines.push("void main() {", `    fragColor = ${p.main};`, "}", "")
  return lines.join("\n")
}
