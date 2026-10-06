// How a document's parameters and sample clips reach the renderer.
import { LOOKUP_WIDTH, lookupPixels } from "@/core/doc/lookup"
import { paramSpec, type ParamTexture } from "@/core/doc/params"
import { isParamRef, type CurveKey, type ForgeDoc, type GradientStop, type Literal, type ParamDef, type ParamDefault } from "@/core/doc/types"
import { nodeDef } from "@/core/nodes/registry"
import { sample, SAMPLES, type MediaItem } from "./media"
import type { DriftRenderer, UniformValue } from "./renderer"

const BIND_TEXTURE: Record<ParamTexture, (r: DriftRenderer, id: string, p: ParamDef, v: ParamDefault) => WebGLTexture | null> = {
  asset: (r, _, __, v) => r.uprightAsset(String(v)),
  clip: (r) => r.sourceTexture(2),
  lookup: (r, id, p, v) => r.dataTexture(`param:${id}`, JSON.stringify(v), () => lookupPixels(p.type as "curve" | "gradient", v as CurveKey[] | GradientStop[]), LOOKUP_WIDTH),
}

/** Resolves sampler parameters (picture, other clip, gradient, curve) to textures. */
export function paramTextures(r: DriftRenderer, doc: ForgeDoc, values: Record<string, ParamDefault>) {
  return (id: string): WebGLTexture | null => {
    const p = doc.params.find((q) => q.identifier === id)
    if (!p) return null
    const v = values[id] ?? p.default
    const texture = paramSpec(p).texture
    if (!texture) return null
    return BIND_TEXTURE[texture](r, id, p, v)
  }
}

export function literalValue(v: Literal): UniformValue {
  if (typeof v === "boolean") return v ? 1 : 0
  return v as UniformValue
}

export function usesClipMask(doc: ForgeDoc) {
  return doc.nodes.some((n) => n.type === "clip_mask")
}

/** The sample `doc` asks to preview on; a Clip mask document falls back to one with a matte. */
export function previewClip(doc: ForgeDoc): MediaItem | null {
  const named = SAMPLES.find((m) => m.id === doc.preview.clip)
  if (usesClipMask(doc)) return named?.matte ? named : sample("dancer")
  return named ?? null
}

export const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, "")

/** Uniform values of every unconnected input, so moving a literal doesn't recompile. */
export function docLiterals(doc: ForgeDoc): Record<string, UniformValue> {
  const lit: Record<string, UniformValue> = {}
  for (const n of doc.nodes) {
    for (const input of nodeDef(n.type)?.inputs ?? []) {
      const v = n.inputs[input.id] ?? input.default
      if (!isParamRef(v)) lit[`k_${safe(n.id)}_${safe(input.id)}`] = literalValue(v)
    }
  }
  return lit
}
