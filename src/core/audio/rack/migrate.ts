import { isParamRef, isSplit, type AudioRack, type ForgeDoc, type Pedal } from "@/core/doc/types"
import { knobSpec, pedalSpec, type PedalSpec } from "../pedals"
import { rackOf } from "./model"

/** A knob bound to a slider; rack knobs only ever bind one. */
type Bound = { param: string }

/**
 * The legacy processor a document is, when it is exactly one classic pedal with every knob a slider
 * of the same name (what schema-1 documents migrate to). Those keep exporting in the old format,
 * so they still load in Drift 0.7.x.
 */
export function legacyProcessorFor(doc: ForgeDoc): string | null {
  const item = loneUnbypassedPedal(rackOf(doc))
  const spec = item && pedalSpec(item.type)
  const processor = spec?.capabilities.legacyProcessor
  if (!item || !spec || !processor) return null
  const bound = Object.values(item.knobs)
  if (bound.length === 0 || !bound.every(isParamRef)) return null
  if (!knobsBindOwnSliders(spec, item.knobs as Record<string, Bound>)) return null
  const names = (bound as Bound[]).map((v) => v.param)
  if (doc.params.length !== names.length || !doc.params.every((p) => names.includes(p.identifier))) return null
  return processor
}

/** The rack's only item, when it is a pedal that isn't bypassed and nothing modulates it. */
function loneUnbypassedPedal(rack: AudioRack): Pedal | null {
  if (rack.chain.length !== 1 || rack.modulators.length || rack.routes.length) return null
  const item = rack.chain[0]
  if (isSplit(item) || (item.bypass !== undefined && item.bypass !== false)) return null
  return item
}

/** Every knob bound to the slider named after it (or one of its aliases). */
function knobsBindOwnSliders(spec: PedalSpec, knobs: Record<string, Bound>): boolean {
  return Object.entries(knobs).every(([k, v]) => v.param === k || !!knobSpec(spec, k)?.aliases?.includes(v.param))
}
