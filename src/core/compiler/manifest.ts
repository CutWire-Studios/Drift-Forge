import { KIND_INFO } from "@/core/doc/kinds"
import { paramSpec } from "@/core/doc/params"
import type { ForgeDoc, ParamDef, ParamDefault } from "@/core/doc/types"
import { classicPedalType, pedalIcon, pedalSpec } from "@/core/audio/pedals"
import { allItems, graphJson, legacyProcessorFor, rackOf } from "@/core/audio/rack"
import { nodeDef } from "@/core/nodes/registry"
import type { CompileResult } from "./compile"

export const MIN_APP_VERSION = "0.7.0"
/** First Drift that reads the parameter types in `nextFeatures` (point, choice, int, colour alpha). */
const NEXT_APP_VERSION = "0.7.1"
/** First Drift that runs audio graphs (processor "graph") and keyframes audio parameters. */
export const AUDIO_GRAPH_APP_VERSION = "0.8.0"

/** A parameter value in the shape Drift's JSON uses for that type. */
function driftValue(doc: ForgeDoc, p: ParamDef, v: ParamDefault): unknown {
  return paramSpec(p).driftValue(doc, p, v)
}

function paramEntry(doc: ForgeDoc, p: ParamDef): Record<string, unknown> {
  const spec = paramSpec(p)
  const e: Record<string, unknown> = { identifier: p.identifier, displayName: p.displayName, type: p.type, ...spec.manifestFields(p) }
  if (spec.exportsDefault) e.defaultValue = driftValue(doc, p, p.default)
  if (p.group) e.group = p.group
  // Today's Drift ignores keys it doesn't know, so these are safe in every export.
  if (p.ui && Object.keys(p.ui).length) e.ui = p.ui
  if (p.showWhen) e.showWhen = p.showWhen
  return e
}

/** Features of `doc` only the next Drift understands (docs/drift-next-params.md). */
export function nextFeatures(doc: ForgeDoc, compiled: CompileResult): string[] {
  const f = new Set<string>()
  for (const p of doc.params) {
    if (paramSpec(p).next) f.add(`param:${p.type}`)
    if (p.type === "color" && p.alpha) f.add("param:color-alpha")
  }
  for (const n of doc.nodes) if (nodeDef(n.type)?.next) f.add(`node:${n.type}`)
  for (const pass of compiled.passes) {
    if (/\bu_audio(Level|Bass|Beat)\b/.test(pass.source)) f.add("uniform:audio")
  }
  if (compiled.usesMask) f.add("requires:mask")
  return [...f].sort()
}

/** The oldest Drift that can load `doc`: 0.7.0 unless it uses something only the next Drift reads. */
export function minAppVersion(doc: ForgeDoc, compiled: CompileResult): string {
  // Audio packages need the Drift that sideloads audio effects; a graph needs the one that runs them.
  if (doc.kind === "audio") return legacyProcessorFor(doc) ? NEXT_APP_VERSION : AUDIO_GRAPH_APP_VERSION
  return nextFeatures(doc, compiled).length > 0 ? NEXT_APP_VERSION : MIN_APP_VERSION
}

/** effect.json / transition.json in the shape Drift's GpuPackageParse reads. */
export function packageJson(doc: ForgeDoc, compiled: CompileResult): Record<string, unknown> {
  if (doc.kind === "audio") return audioPackageJson(doc)
  const pipeline: Record<string, unknown> = {
    intermediateBuffers: compiled.buffers.map((id) => ({ id, scale: 1.0 })),
    passes: compiled.passes.map((p, i) => ({
      passIndex: i,
      fragmentShader: p.file,
      inputs: p.inputs,
      output: p.output,
    })),
  }
  if (compiled.textures.length) pipeline.textures = compiled.textures.map((t) => ({ id: t.id, file: t.file }))

  const json: Record<string, unknown> = {
    id: doc.meta.id,
    displayName: doc.meta.displayName,
    category: doc.meta.category,
    order: 1000,
  }
  if (doc.meta.description) json.description = doc.meta.description
  if (doc.kind === "effect") json.backend = "gpu"
  else json.audioCurve = "crossfade"
  if (compiled.usesMask) json.requires = "mask"
  json.parameters = doc.params.map((p) => paramEntry(doc, p))
  json.pipeline = pipeline
  if (doc.presets?.length) {
    json.presets = doc.presets.map((pr) => ({
      name: pr.name,
      values: Object.fromEntries(
        Object.entries(pr.values).flatMap(([k, v]) => {
          const p = doc.params.find((q) => q.identifier === k)
          return p ? [[k, driftValue(doc, p, v)]] : []
        }),
      ),
    }))
  }
  const features = nextFeatures(doc, compiled)
  if (features.length) json.nextFeatures = features
  return json
}

/**
 * audio-effect.json. A board that is one classic pedal with every knob a slider is written as the
 * built-in processor it is, which every Drift since 0.7.1 loads; anything else is a "graph" that
 * needs Drift 0.8.0. Also what the preview hands the wasm build, so both read the same manifest.
 */
export function audioPackageJson(doc: ForgeDoc): Record<string, unknown> {
  const rack = rackOf(doc)
  const legacy = legacyProcessorFor(doc)
  const first = allItems(rack).find((i) => i.type !== "split")?.type
  const json: Record<string, unknown> = {
    id: doc.meta.id,
    displayName: doc.meta.displayName,
    category: doc.meta.category,
    icon: pedalIcon(first),
    order: 1000,
  }
  if (doc.meta.description) json.description = doc.meta.description
  json.backend = "juce"
  json.processor = legacy ?? "graph"
  // A graph's tails are measured by Drift itself, which treats this as a floor.
  json.prerollMs = legacy ? pedalSpec(classicPedalType(legacy))!.prerollMs : 0
  json.parameters = doc.params.map((p) => paramEntry(doc, p))
  if (!legacy) {
    json.graph = graphJson(doc)
    const features = new Set(["audio:graph"])
    if (rack.modulators.length) features.add("audio:modulation")
    if (allItems(rack).some((i) => pedalSpec(i.type)?.capabilities.impulseResponse)) features.add("audio:convolution")
    json.nextFeatures = [...features].sort()
  }
  if (doc.presets?.length) {
    json.presets = doc.presets.map((pr) => ({
      name: pr.name,
      values: Object.fromEntries(
        Object.entries(pr.values).flatMap(([k, v]) => {
          const p = doc.params.find((q) => q.identifier === k)
          return p ? [[k, driftValue(doc, p, v)]] : []
        }),
      ),
    }))
  }
  return json
}

export function packageJsonName(doc: ForgeDoc): string {
  return KIND_INFO[doc.kind].manifestFile
}
