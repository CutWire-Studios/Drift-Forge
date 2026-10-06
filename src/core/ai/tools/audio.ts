// The tools an AI builds audio effects with: the same pedalboard operations the editor uses
// (core/audio/rack), described in short plain text.
import { z } from "zod"
import { BUILTIN_IRS } from "@/core/audio/irs"
import { continuous, formatKnob, isClassic, knobSpec, MODULATORS, modulatorSpec, PEDAL_GROUPS, PEDALS, pedalSpec, type KnobSpec, type PedalSpec } from "@/core/audio/pedals"
import * as rack from "@/core/audio/rack"
import { compile } from "@/core/compiler/compile"
import { isOpError, updateParam } from "@/core/edit/ops"
import { isParamRef, isSplit, type ForgeDoc, type KnobValue, type Modulator, type RackItem, type SplitBlock } from "@/core/doc/types"
import { AUDIO_KINDS, defineTool, fail, fmt, type ToolOutcome } from "./define"

const id = (what: string) => z.string().describe(`${what} id, e.g. p4k2p9a`)
const where = {
  after: z.string().describe("Put it right after this pedal or split (any lane). Default: the end of the main chain.").optional(),
  lane: z.string().describe("Or: a split lane id (from view_rack) to add it at the end of").optional(),
}
const settings = z.record(z.string(), z.unknown()).describe("knob id → value").optional()
const IR_IDS = BUILTIN_IRS.map((b) => b.id) as [string, ...string[]]

const done = (doc: ForgeDoc, result: string, created?: string[]): ToolOutcome => ({ doc, result, created })
const withProblems = (result: string, problems: string[]) => `${result}${problems.length ? `; not set: ${problems.join("; ")}` : ""}`

function knobKind(k: KnobSpec): string {
  if (k.scale === "toggle") return "switch"
  if (k.scale === "choice") return `one of ${(k.options ?? []).join("|")}`
  return `${fmt(k.min)}..${fmt(k.max)}${k.unit ? ` ${k.unit}` : ""}`
}

function knobDefault(k: KnobSpec): string | undefined {
  if (k.scale === "choice") return k.options?.[k.default]
  if (k.scale === "toggle") return String(k.default > 0.5)
  return fmt(k.default)
}

function knobLine(k: KnobSpec): string {
  const kind = knobKind(k)
  const def = knobDefault(k)
  return `  ${k.id} (${kind}, default ${def}${k.scale === "log" ? ", log" : ""}): ${k.label}`
}

export function describePedal(spec: PedalSpec): string {
  const what = MODULATORS.includes(spec) ? "modulator" : spec.category
  return [`${spec.type} — ${spec.label} (${what})`, ...spec.knobs.map(knobLine)].join("\n")
}

export function listPedals(): string {
  const lines = [`pedals: ${PEDALS.filter((p) => !isClassic(p.type)).map((p) => p.type).join(", ")}`]
  for (const g of PEDAL_GROUPS) {
    const classic = PEDALS.filter((p) => isClassic(p.type) && p.category === g.id)
    if (classic.length) lines.push(`classic ${g.id}: ${classic.map((p) => p.type).join(", ")}`)
  }
  lines.push(`splits: add_split mode parallel|bands`)
  lines.push(`modulators: ${MODULATORS.map((m) => m.type).join(", ")}`)
  return lines.join("\n")
}

function valueText(v: KnobValue | undefined, k?: KnobSpec): string {
  if (isParamRef(v)) return `slider:${v.param}`
  if (v === undefined) return "?"
  return k ? formatKnob(k, v) : String(v)
}

const MODULATOR_EXTRA: Partial<Record<Modulator["type"], (m: Modulator) => string>> = {
  steps: (m) => ` steps=[${(m.steps ?? []).map(fmt).join(",")}]`,
  envelope: (m) => ` source=${m.source ?? "input"}`,
}

export function viewRack(doc: ForgeDoc): string {
  const r = rack.rackOf(doc)
  const lines = [`audio effect "${doc.meta.displayName}" — chain from In to Out:`]
  const item = (it: RackItem, indent: string) => {
    if (isSplit(it)) {
      const extra = [it.crossfade ? `crossfade blend=${valueText(it.blend)}` : "", ...(it.crossovers ?? []).map((c, i) => `crossover${i + 1}=${valueText(c)}Hz`)].filter(Boolean)
      lines.push(`${indent}${it.id} split ${it.mode}${extra.length ? ` {${extra.join(", ")}}` : ""}`)
      it.lanes.forEach((l, i) => {
        lines.push(`${indent}  lane${i + 1} ${l.id}${l.gain !== 1 ? ` level=${fmt(l.gain)}` : ""}${l.chain.length ? ":" : ": (dry)"}`)
        for (const c of l.chain) item(c, `${indent}    `)
      })
      return
    }
    const spec = pedalSpec(it.type)
    const changed: string[] = []
    for (const k of spec?.knobs ?? []) {
      const v = it.knobs[k.id]
      const isDefault = !isParamRef(v) && (k.scale === "toggle" ? !!v === k.default > 0.5 : Math.abs(Number(v) - k.default) < 1e-6)
      if (!isDefault) changed.push(`${k.id}=${valueText(v, k)}`)
    }
    if (it.bypass !== undefined && it.bypass !== false) changed.push(`bypass=${valueText(it.bypass)}`)
    if (it.ir) changed.push(`space=${it.ir.replace("builtin:", "")}`)
    lines.push(`${indent}${it.id} ${it.type}${changed.length ? ` {${changed.join(", ")}}` : ""}`)
  }
  for (const it of r.chain) item(it, "  ")
  if (!r.chain.length) lines.push("  (empty: the sound passes through)")
  for (const m of r.modulators) {
    const spec = modulatorSpec(m.type)
    const knobs = (spec?.knobs ?? []).map((k) => `${k.id}=${valueText(m.knobs[k.id], k)}`)
    const extra = MODULATOR_EXTRA[m.type]?.(m) ?? ""
    lines.push(`modulator ${m.id} ${m.type} {${knobs.join(", ")}}${extra}`)
  }
  for (const rt of r.routes) lines.push(`route ${rt.id}: ${rt.from} -> ${rt.to}.${rt.knob} depth=${valueText(rt.depth)}`)
  if (doc.params.length) lines.push(`sliders: ${doc.params.map((p) => `${p.identifier} "${p.displayName}"`).join(", ")}`)
  const c = compile(doc, { mode: "export" })
  lines.push(c.ok ? "status: OK" : `problems: ${c.errors.map((e) => e.message).join(" | ")}`)
  return lines.join("\n")
}

/** Resolves `after`/`lane` into where an item goes. */
function slotFor(doc: ForgeDoc, args: { after?: string; lane?: string }): rack.Slot | string {
  const r = rack.rackOf(doc)
  if (args.after) {
    const at = rack.findItem(r, args.after)
    if (!at) return `No pedal or split "${args.after}". Use view_rack.`
    return { lane: at.lane?.id ?? null, index: at.index + 1 }
  }
  if (args.lane) return { lane: args.lane }
  return { lane: null }
}

/** Which control a (target, knob) pair names, for set_knob and expose_knob. */
function pathFor(doc: ForgeDoc, target: string, knob: string): rack.ValuePath | string {
  const r = rack.rackOf(doc)
  if (r.routes.some((x) => x.id === target)) return knob === "depth" ? { kind: "depth", route: target } : "A route only has 'depth'."
  const mod = r.modulators.find((m) => m.id === target)
  if (mod) {
    const k = knobSpec(modulatorSpec(mod.type)!, knob)
    return k ? { kind: "modKnob", mod: mod.id, knob: k.id } : `${mod.type} has knobs: ${modulatorSpec(mod.type)!.knobs.map((x) => x.id).join(", ")}.`
  }
  const at = rack.findItem(r, target)
  if (!at) return `No pedal, split, modulator or route "${target}". Use view_rack.`
  if (isSplit(at.item)) {
    if (knob === "blend") return { kind: "blend", item: target }
    const cross = /^crossover(\d)$/.exec(knob)
    if (cross) return { kind: "crossover", item: target, index: Number(cross[1]) - 1 }
    return "A split has 'blend' (crossfade), 'crossover1'… (bands) and 'lane1_level'…."
  }
  if (knob === "bypass") return { kind: "bypass", item: target }
  const spec = pedalSpec(at.item.type)!
  const k = knobSpec(spec, knob)
  return k ? { kind: "knob", item: target, knob: k.id } : `${spec.type} has knobs: ${spec.knobs.map((x) => x.id).join(", ")}.`
}

function parseChoice(options: string[], v: unknown): number | string {
  const i = options.findIndex((o) => o.toLowerCase() === String(v).toLowerCase())
  if (i >= 0) return i
  if (typeof v === "number" && v >= 0 && v < options.length) return Math.round(v)
  return `Use one of: ${options.join(", ")}.`
}

function parseValue(k: KnobSpec, v: unknown): number | boolean | string {
  if (k.scale === "toggle") return typeof v === "boolean" ? v : v === "true" || v === 1 || v === "on"
  if (k.scale === "choice") return parseChoice(k.options ?? [], v)
  const n = typeof v === "string" ? Number.parseFloat(v) : v
  return typeof n === "number" && Number.isFinite(n) ? n : "Give a number."
}

function setKnob(doc: ForgeDoc, target: string, knob: string, value: unknown): { doc: ForgeDoc } | { error: string } {
  const lane = /^lane(\d)_level$/.exec(knob)
  if (lane) {
    const at = rack.findItem(rack.rackOf(doc), target)
    const split = at && isSplit(at.item) ? (at.item as SplitBlock) : undefined
    const l = split?.lanes[Number(lane[1]) - 1]
    if (!l) return { error: "No such split lane." }
    const n = Number(value)
    return Number.isFinite(n) ? { doc: rack.setLaneGain(doc, target, l.id, n) } : { error: "Give a number." }
  }
  const path = pathFor(doc, target, knob)
  if (typeof path === "string") return { error: path }
  const spec = rack.valueSpec(rack.rackOf(doc), path)!
  if (isParamRef(rack.getValue(rack.rackOf(doc), path))) return { error: `${knob} is a Drift slider; its default is set in the Sliders tab.` }
  const v = parseValue(spec, value)
  if (typeof v === "string") return { error: v }
  return { doc: rack.setValue(doc, path, v) }
}

function settle(doc: ForgeDoc, target: string, settings: Record<string, unknown> = {}): { doc: ForgeDoc; problems: string[] } {
  const problems: string[] = []
  for (const [k, v] of Object.entries(settings)) {
    const r = setKnob(doc, target, k, v)
    if ("error" in r) problems.push(`${k}: ${r.error}`)
    else doc = r.doc
  }
  return { doc, problems }
}

export const AUDIO_TOOLS = [
  defineTool({
    name: "list_pedals",
    description: "List the pedals, splits and modulators you can add, by group.",
    schema: z.strictObject({}),
    kinds: AUDIO_KINDS,
    run: (doc) => done(doc, listPedals()),
  }),
  defineTool({
    name: "describe_pedal",
    description: "Show the knobs (ranges, defaults, units, options) of pedal or modulator types. Ask for everything you need in one call.",
    schema: z.strictObject({ types: z.array(z.string()).max(8) }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const types = args.types.filter(Boolean)
      if (!types.length) return fail(doc, "Give the pedal types to describe.")
      const result = types
        .map((t) => {
          const spec = pedalSpec(t) ?? modulatorSpec(t)
          return spec ? describePedal(spec) : `No pedal or modulator "${t}".`
        })
        .join("\n\n")
      return done(doc, result)
    },
  }),
  defineTool({
    name: "view_rack",
    description: "Show the board: the chain in order (splits with their lanes), changed knobs, modulators, routes, sliders and any problems.",
    schema: z.strictObject({}),
    kinds: AUDIO_KINDS,
    run: (doc) => done(doc, viewRack(doc)),
  }),
  defineTool({
    name: "add_pedal",
    description: "Add a pedal. Audio runs through the chain in order. Optionally set knobs straight away.",
    schema: z.strictObject({ type: z.string(), ...where, settings }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(doc, slot)
      const r = rack.addPedal(doc, args.type, slot)
      if (isOpError(r)) return fail(doc, `${r.error} Use list_pedals.`)
      const s = settle(r.doc, r.id, args.settings)
      return done(s.doc, withProblems(`added ${r.id}`, s.problems), [r.id])
    },
  }),
  defineTool({
    name: "add_split",
    description:
      "Add a split: 'parallel' runs the same sound through every lane and adds them up (an empty lane keeps the dry sound); 'bands' gives each lane one frequency band (lows, mids, highs). Returns its lane ids. crossfade (parallel, 2 lanes) blends between the lanes instead of adding.",
    schema: z.strictObject({
      mode: z.enum(["parallel", "bands"]),
      lanes: z.coerce.number().int().min(2).max(4).optional(),
      crossfade: z.boolean().optional(),
      ...where,
    }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(doc, slot)
      const r = rack.addSplit(doc, args.mode, args.lanes ?? 2, slot)
      if (isOpError(r)) return fail(doc, r.error)
      let d = r.doc
      if (args.crossfade) {
        const c = rack.setCrossfade(d, r.id, true)
        if (isOpError(c)) return fail(doc, c.error)
        d = c.doc
      }
      const lanes = (rack.findItem(rack.rackOf(d), r.id)!.item as SplitBlock).lanes.map((l) => l.id)
      return done(d, `added ${r.id} with lanes ${lanes.join(", ")}`, [r.id])
    },
  }),
  defineTool({
    name: "move_pedal",
    description: "Move a pedal or split to right after another one, or to the end of a lane.",
    schema: z.strictObject({ id: id("Pedal or split"), ...where }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(doc, slot)
      const r = rack.moveItem(doc, args.id, slot)
      return isOpError(r) ? fail(doc, r.error) : done(r.doc, "moved")
    },
  }),
  defineTool({
    name: "remove_pedal",
    description: "Remove a pedal or split (a split takes its lanes with it), and any modulation going to it.",
    schema: z.strictObject({ id: id("Pedal or split") }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      if (!rack.findItem(rack.rackOf(doc), args.id)) return fail(doc, `No pedal or split "${args.id}".`)
      return done(rack.removeItem(doc, args.id), "removed")
    },
  }),
  defineTool({
    name: "set_knob",
    description:
      "Set a knob. On a pedal: any knob id, or 'bypass'. On a split: 'blend', 'crossover1'…, or 'lane1_level'…. On a modulator: its knobs. On a route (id from route_modulation): 'depth'. Choices take the option name; switches take true/false.",
    schema: z.strictObject({ target: id("Pedal, split, modulator or route"), knob: z.string(), value: z.unknown() }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const r = setKnob(doc, args.target, args.knob, args.value)
      return "error" in r ? fail(doc, r.error) : done(r.doc, "set")
    },
  }),
  defineTool({
    name: "add_modulator",
    description:
      "Add a modulator that turns knobs over time: 'lfo' (a steady wobble), 'envelope' (follows loudness; source = 'input' or a pedal id whose output it hears), 'steps' (a rhythmic pattern of 1–16 values 0..1). Then route it with route_modulation.",
    schema: z.strictObject({
      type: z.enum(["lfo", "envelope", "steps"]),
      settings,
      source: z.string().optional(),
      steps: z.array(z.number()).max(16).optional(),
    }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const r = rack.addModulator(doc, args.type)
      if (isOpError(r)) return fail(doc, r.error)
      let d = r.doc
      if (args.source !== undefined) {
        const before = d
        d = rack.setModulatorSource(d, r.id, args.source)
        if (d === before && args.source !== "input") return fail(doc, `No pedal "${args.source}" to follow.`)
      }
      if (args.steps) d = rack.setSteps(d, r.id, args.steps.filter(Number.isFinite))
      const s = settle(d, r.id, args.settings)
      return done(s.doc, withProblems(`added ${r.id}`, s.problems))
    },
  }),
  defineTool({
    name: "route_modulation",
    description: "Make a modulator move a pedal knob. depth is a fraction of the knob's range, -1..1 (0.3 = a third of it). Routing the same pair again changes the depth.",
    schema: z.strictObject({ from: id("Modulator"), pedal: id("Pedal"), knob: z.string(), depth: z.coerce.number() }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const r = rack.addRoute(doc, args.from, args.pedal, args.knob, args.depth)
      if (isOpError(r)) return fail(doc, r.error)
      const at = rack.findItem(rack.rackOf(r.doc), args.pedal)!
      const k = knobSpec(pedalSpec((at.item as { type: string }).type)!, args.knob)!
      return done(r.doc, `route ${r.id}${continuous(k) ? "" : " (a switch)"}`)
    },
  }),
  defineTool({
    name: "set_ir",
    description: `Choose the space a convolution pedal puts the sound in: ${IR_IDS.join(", ")}. (Recordings of the user's own are uploaded in the editor.)`,
    schema: z.strictObject({ pedal: id("Convolution pedal"), space: z.enum(IR_IDS) }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const at = rack.findItem(rack.rackOf(doc), args.pedal)
      if (!at || isSplit(at.item) || !pedalSpec(at.item.type)?.capabilities.impulseResponse) return fail(doc, "That isn't a convolution pedal.")
      return done(rack.setIr(doc, at.item.id, `builtin:${args.space}`), "set")
    },
  }),
  defineTool({
    name: "expose_knob",
    description: "Turn a knob into a slider people can change per clip in Drift (same targets as set_knob). Use for the 2–5 that matter most, with short clear labels.",
    schema: z.strictObject({ target: id("Pedal, split, modulator or route"), knob: z.string(), label: z.string().optional() }),
    kinds: AUDIO_KINDS,
    run: (doc, args) => {
      const path = pathFor(doc, args.target, args.knob)
      if (typeof path === "string") return fail(doc, path)
      const r = rack.exposeValue(doc, path)
      if (isOpError(r)) return fail(doc, r.error)
      const label = (args.label ?? "").trim().slice(0, 40)
      if (!label) return done(r.doc, `slider ${r.param}`)
      const named = updateParam(r.doc, r.param, { displayName: label })
      return isOpError(named) ? done(r.doc, `slider ${r.param}`) : done(named.doc, `slider ${r.param} "${label}"`)
    },
  }),
]
