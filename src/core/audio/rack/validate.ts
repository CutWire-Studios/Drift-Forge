import { isParamRef, isSplit, type ForgeDoc, type KnobValue, type Pedal, type SplitBlock } from "@/core/doc/types"
import { continuous, knobSpec, MAX_LANES, MAX_NODES, MAX_SPLIT_DEPTH, modulatorSpec, pedalSpec } from "../pedals"
import { builtinIr, pedalAt, rackOf, walkRack } from "./model"
import { modulatorKind } from "./modulators"

type Check = (v: KnobValue | undefined, where: string) => void

function splitProblems(item: SplitBlock, depth: number, errors: string[], checkValue: Check) {
  if (depth >= MAX_SPLIT_DEPTH) errors.push("Splits nest at most two deep.")
  if (item.lanes.length < 2 || item.lanes.length > MAX_LANES) errors.push(`A split needs 2 to ${MAX_LANES} lanes.`)
  if (item.crossfade && (item.mode !== "parallel" || item.lanes.length !== 2)) errors.push("Blending needs a parallel split with two lanes.")
  if (item.mode === "bands" && (item.crossovers?.length ?? 0) !== item.lanes.length - 1) errors.push("A band split needs one crossover per lane boundary.")
  checkValue(item.blend, "A split")
  item.crossovers?.forEach((c) => checkValue(c, "A crossover"))
}

function pedalProblems(doc: ForgeDoc, item: Pedal, errors: string[], checkValue: Check) {
  const spec = pedalSpec(item.type)
  if (!spec) {
    errors.push(`Drift has no pedal called "${item.type}".`)
    return
  }
  for (const [k, v] of Object.entries(item.knobs)) {
    if (!knobSpec(spec, k)) errors.push(`${spec.label} has no knob "${k}".`)
    checkValue(v, spec.label)
  }
  checkValue(item.bypass, spec.label)
  if (spec.capabilities.impulseResponse) {
    if (!item.ir) errors.push("A convolution reverb needs an impulse response.")
    else if (builtinIr(item.ir) === null && !doc.assets.some((a) => a.id === item.ir)) errors.push("A convolution reverb's impulse response is missing.")
  }
}

/** Problems Drift would reject the graph for, in words. Empty when it will load. */
export function validateRack(doc: ForgeDoc): string[] {
  const rack = rackOf(doc)
  const errors: string[] = []
  const params = new Set(doc.params.map((p) => p.identifier))
  const ids = new Set<string>()
  const checkValue: Check = (v, where) => {
    if (isParamRef(v) && !params.has(v.param)) errors.push(`${where} uses a slider that no longer exists.`)
  }
  let count = 0
  walkRack(rack.chain, ({ item, depth }) => {
    count++
    if (ids.has(item.id)) errors.push(`Two pedals share the id ${item.id}.`)
    ids.add(item.id)
    if (isSplit(item)) splitProblems(item, depth, errors, checkValue)
    else pedalProblems(doc, item, errors, checkValue)
  })
  if (count > MAX_NODES) errors.push(`A pedalboard holds at most ${MAX_NODES} pedals.`)
  const mods = new Set(rack.modulators.map((m) => m.id))
  for (const m of rack.modulators) {
    if (!modulatorSpec(m.type)) errors.push(`Drift has no modulator called "${m.type}".`)
    const problem = modulatorKind(m.type).problem(m)
    if (problem) errors.push(problem)
    if (m.source && m.source !== "input" && !ids.has(m.source)) errors.push("An envelope follower listens to a pedal that's gone.")
    for (const v of Object.values(m.knobs)) checkValue(v, "A modulator")
  }
  for (const r of rack.routes) {
    if (!mods.has(r.from)) errors.push("A modulation route comes from a modulator that's gone.")
    const target = pedalAt(rack, r.to)
    const spec = target && pedalSpec(target.type)
    const k = spec && knobSpec(spec, r.knob)
    if (!k) errors.push("A modulation route goes to a knob that's gone.")
    else if (!continuous(k)) errors.push(`${spec!.label}'s ${k.label} is a switch and can't be modulated.`)
    checkValue(r.depth, "A modulation route")
  }
  return [...new Set(errors)]
}
