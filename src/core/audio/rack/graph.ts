// What Drift and the preview are built from: the "graph" object of audio-effect.json, and a
// signature that changes only when the graph's shape does.
import { isParamRef, isSplit, type ForgeDoc, type KnobValue, type RackItem } from "@/core/doc/types"
import { builtinIr, rackOf } from "./model"
import { modulatorKind } from "./modulators"

/** Where an impulse response lives inside the package, and in the preview's staged files. */
export function irPath(doc: ForgeDoc, ir: string): string {
  const builtin = builtinIr(ir)
  if (builtin !== null) return `ir/${builtin}.wav`
  const asset = doc.assets.find((a) => a.id === ir)
  return `ir/${asset ? asset.id : ir}.wav`
}

function knobJson(v: KnobValue): unknown {
  if (isParamRef(v)) return { param: v.param }
  if (typeof v === "boolean") return v ? 1 : 0
  return v
}

const knobsJson = (knobs: Record<string, KnobValue>) => Object.fromEntries(Object.entries(knobs).map(([k, v]) => [k, knobJson(v)]))

/** The "graph" object of audio-effect.json, exactly as Drift's AudioGraph parser reads it. */
export function graphJson(doc: ForgeDoc): Record<string, unknown> {
  const rack = rackOf(doc)
  const node = (item: RackItem): Record<string, unknown> => {
    if (isSplit(item)) {
      const out: Record<string, unknown> = { id: item.id, type: "split", mode: item.mode }
      if (item.crossfade) out.crossfade = true
      if (item.blend !== undefined) out.blend = knobJson(item.blend)
      if (item.mode === "bands" && item.crossovers) out.crossovers = item.crossovers.map(knobJson)
      out.lanes = item.lanes.map((l) => ({ gain: l.gain, chain: l.chain.map(node) }))
      return out
    }
    const out: Record<string, unknown> = { id: item.id, type: item.type, knobs: knobsJson(item.knobs) }
    if (item.bypass !== undefined && item.bypass !== false) out.bypass = knobJson(item.bypass)
    if (item.ir) out.ir = irPath(doc, item.ir)
    const routes = rack.routes.filter((r) => r.to === item.id)
    if (routes.length) {
      const mod: Record<string, unknown[]> = {}
      for (const r of routes) (mod[r.knob] ??= []).push({ from: r.from, depth: knobJson(r.depth) })
      out.mod = mod
    }
    return out
  }
  const graph: Record<string, unknown> = { version: 1 }
  if (rack.modulators.length) {
    graph.modulators = rack.modulators.map((m) => ({ id: m.id, type: m.type, knobs: knobsJson(m.knobs), ...modulatorKind(m.type).graphFields(m) }))
  }
  graph.chain = rack.chain.map(node)
  return graph
}

/**
 * Changes whenever the graph Drift would build changes shape, and not when only a fixed value
 * does: those the preview pushes into the running graph instead of rebuilding it (which would cut
 * every tail). Parameter defaults are excluded for the same reason.
 */
export function rackSignature(doc: ForgeDoc): string {
  const strip = (v: KnobValue) => (isParamRef(v) ? v : 0)
  const knobs = (k: Record<string, KnobValue>) => Object.entries(k).map(([id, v]) => [id, strip(v)])
  const shape = (item: RackItem): unknown => {
    if (!isSplit(item)) return [item.id, item.type, item.ir ?? null, knobs(item.knobs), strip(item.bypass ?? false)]
    const blend = item.blend === undefined ? null : strip(item.blend)
    return [item.id, item.mode, !!item.crossfade, blend, (item.crossovers ?? []).map(strip), item.lanes.map((l) => l.chain.map(shape))]
  }
  const rack = rackOf(doc)
  return JSON.stringify([
    doc.params.map((p) => [p.identifier, p.type]),
    rack.chain.map(shape),
    rack.modulators.map((m) => [m.id, m.type, m.source ?? null, (m.steps ?? []).length, knobs(m.knobs)]),
    rack.routes.map((r) => [r.from, r.to, r.knob, strip(r.depth)]),
  ])
}
