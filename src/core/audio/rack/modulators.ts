// What differs between the modulator kinds, declared once per kind.
import type { Modulator } from "@/core/doc/types"
import { MAX_STEPS } from "../pedals"

interface ModulatorKind {
  /** swings both ways around the knob it moves; the others only push up from it */
  bipolar: boolean
  /** has a drawn sequence (Modulator.steps) */
  steps: boolean
  /** follows a signal (Modulator.source) */
  followsSource: boolean
  /** Fields a new one starts with, besides its knobs. */
  initial(): Partial<Modulator>
  /** Its keys in the "graph" object of audio-effect.json, besides id, type and knobs. */
  graphFields(m: Modulator): Record<string, unknown>
  problem(m: Modulator): string | null
}

const none = () => ({})
const fine = () => null

export const MODULATOR_KINDS: Record<Modulator["type"], ModulatorKind> = {
  lfo: { bipolar: true, steps: false, followsSource: false, initial: none, graphFields: none, problem: fine },
  envelope: {
    bipolar: false,
    steps: false,
    followsSource: true,
    initial: () => ({ source: "input" }),
    graphFields: (m) => (m.source && m.source !== "input" ? { source: m.source } : {}),
    problem: fine,
  },
  steps: {
    bipolar: false,
    steps: true,
    followsSource: false,
    initial: () => ({ steps: [1, 0.25, 0.75, 0, 0.5, 1, 0.25, 0.5] }),
    graphFields: (m) => ({ steps: m.steps ?? [1] }),
    problem: (m) => (!m.steps?.length || m.steps.length > MAX_STEPS ? `A step sequencer has 1 to ${MAX_STEPS} steps.` : null),
  },
}

/** Unknown types (a document from a newer Forge) behave like an LFO: nothing extra. */
export const modulatorKind = (type: string): ModulatorKind => MODULATOR_KINDS[type as Modulator["type"]] ?? MODULATOR_KINDS.lfo
