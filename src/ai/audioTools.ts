// The tools an AI builds audio effects with: the same pedalboard operations the editor uses
// (audio/rack.ts), described in short plain text. Shared tools (set_details, check) and the
// conversation tools live in tools.ts.
import { BUILTIN_IRS } from "@/audio/irs"
import { continuous, formatKnob, isClassic, knobSpec, MODULATORS, modulatorSpec, PEDAL_GROUPS, PEDALS, pedalSpec, type KnobSpec, type PedalSpec } from "@/audio/pedals"
import * as rack from "@/audio/rack"
import { compile } from "@/compiler/compile"
import { isOpError, updateParam } from "@/doc/ops"
import { isParamRef, isSplit, type ForgeDoc, type KnobValue, type Modulator, type RackItem, type SplitBlock } from "@/doc/types"
import type { ToolOutcome, ToolSpec } from "./tools"

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false })
const id = (what: string) => ({ type: "string", description: `${what} id, e.g. p4k2p9a` })
const where = {
  after: { type: "string", description: "Put it right after this pedal or split (any lane). Default: the end of the main chain." },
  lane: { type: "string", description: "Or: a split lane id (from view_rack) to add it at the end of" },
}

export const AUDIO_TOOLS: ToolSpec[] = [
  {
    name: "list_pedals",
    description: "List the pedals, splits and modulators you can add, by group.",
    parameters: obj({}),
  },
  {
    name: "describe_pedal",
    description: "Show the knobs (ranges, defaults, units, options) of pedal or modulator types. Ask for everything you need in one call.",
    parameters: obj({ types: { type: "array", items: { type: "string" }, maxItems: 8 } }, ["types"]),
  },
  {
    name: "view_rack",
    description: "Show the board: the chain in order (splits with their lanes), changed knobs, modulators, routes, sliders and any problems.",
    parameters: obj({}),
  },
  {
    name: "add_pedal",
    description: "Add a pedal. Audio runs through the chain in order. Optionally set knobs straight away.",
    parameters: obj({ type: { type: "string" }, ...where, settings: { type: "object", description: "knob id → value" } }, ["type"]),
  },
  {
    name: "add_split",
    description:
      "Add a split: 'parallel' runs the same sound through every lane and adds them up (an empty lane keeps the dry sound); 'bands' gives each lane one frequency band (lows, mids, highs). Returns its lane ids. crossfade (parallel, 2 lanes) blends between the lanes instead of adding.",
    parameters: obj(
      { mode: { type: "string", enum: ["parallel", "bands"] }, lanes: { type: "integer", minimum: 2, maximum: 4 }, crossfade: { type: "boolean" }, ...where },
      ["mode"],
    ),
  },
  {
    name: "move_pedal",
    description: "Move a pedal or split to right after another one, or to the end of a lane.",
    parameters: obj({ id: id("Pedal or split"), ...where }, ["id"]),
  },
  {
    name: "remove_pedal",
    description: "Remove a pedal or split (a split takes its lanes with it), and any modulation going to it.",
    parameters: obj({ id: id("Pedal or split") }, ["id"]),
  },
  {
    name: "set_knob",
    description:
      "Set a knob. On a pedal: any knob id, or 'bypass'. On a split: 'blend', 'crossover1'…, or 'lane1_level'…. On a modulator: its knobs. On a route (id from route_modulation): 'depth'. Choices take the option name; switches take true/false.",
    parameters: obj({ target: id("Pedal, split, modulator or route"), knob: { type: "string" }, value: {} }, ["target", "knob", "value"]),
  },
  {
    name: "add_modulator",
    description:
      "Add a modulator that turns knobs over time: 'lfo' (a steady wobble), 'envelope' (follows loudness; source = 'input' or a pedal id whose output it hears), 'steps' (a rhythmic pattern of 1–16 values 0..1). Then route it with route_modulation.",
    parameters: obj(
      {
        type: { type: "string", enum: ["lfo", "envelope", "steps"] },
        settings: { type: "object", description: "knob id → value" },
        source: { type: "string" },
        steps: { type: "array", items: { type: "number" }, maxItems: 16 },
      },
      ["type"],
    ),
  },
  {
    name: "route_modulation",
    description: "Make a modulator move a pedal knob. depth is a fraction of the knob's range, -1..1 (0.3 = a third of it). Routing the same pair again changes the depth.",
    parameters: obj({ from: id("Modulator"), pedal: id("Pedal"), knob: { type: "string" }, depth: { type: "number" } }, ["from", "pedal", "knob", "depth"]),
  },
  {
    name: "set_ir",
    description: `Choose the space a convolution pedal puts the sound in: ${BUILTIN_IRS.map((b) => b.id).join(", ")}. (Recordings of the user's own are uploaded in the editor.)`,
    parameters: obj({ pedal: id("Convolution pedal"), space: { type: "string", enum: BUILTIN_IRS.map((b) => b.id) } }, ["pedal", "space"]),
  },
  {
    name: "expose_knob",
    description: "Turn a knob into a slider people can change per clip in Drift (same targets as set_knob). Use for the 2–5 that matter most, with short clear labels.",
    parameters: obj({ target: id("Pedal, split, modulator or route"), knob: { type: "string" }, label: { type: "string" } }, ["target", "knob"]),
  },
]

export const AUDIO_TOOL_NAMES = new Set(AUDIO_TOOLS.map((t) => t.name))

const fmt = (n: number) => String(Number(n.toFixed(3)))

function knobLine(k: KnobSpec): string {
  const kind =
    k.scale === "toggle" ? "switch" : k.scale === "choice" ? `one of ${(k.options ?? []).join("|")}` : `${fmt(k.min)}..${fmt(k.max)}${k.unit ? ` ${k.unit}` : ""}`
  const def = k.scale === "choice" ? k.options?.[k.default] : k.scale === "toggle" ? String(k.default > 0.5) : fmt(k.default)
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
    const extra = m.type === "steps" ? ` steps=[${(m.steps ?? []).map(fmt).join(",")}]` : m.type === "envelope" ? ` source=${m.source ?? "input"}` : ""
    lines.push(`modulator ${m.id} ${m.type} {${knobs.join(", ")}}${extra}`)
  }
  for (const rt of r.routes) lines.push(`route ${rt.id}: ${rt.from} -> ${rt.to}.${rt.knob} depth=${valueText(rt.depth)}`)
  if (doc.params.length) lines.push(`sliders: ${doc.params.map((p) => `${p.identifier} "${p.displayName}"`).join(", ")}`)
  const c = compile(doc, { mode: "export" })
  lines.push(c.ok ? "status: OK" : `problems: ${c.errors.map((e) => e.message).join(" | ")}`)
  return lines.join("\n")
}

/** Resolves `after`/`lane` into where an item goes. */
function slotFor(doc: ForgeDoc, args: Record<string, unknown>): rack.Slot | string {
  const r = rack.rackOf(doc)
  if (typeof args.after === "string" && args.after) {
    const at = rack.findItem(r, args.after)
    if (!at) return `No pedal or split "${args.after}". Use view_rack.`
    return { lane: at.lane?.id ?? null, index: at.index + 1 }
  }
  if (typeof args.lane === "string" && args.lane) return { lane: args.lane }
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

function parseValue(k: KnobSpec, v: unknown): number | boolean | string {
  if (k.scale === "toggle") return typeof v === "boolean" ? v : v === "true" || v === 1 || v === "on"
  if (k.scale === "choice") {
    const i = (k.options ?? []).findIndex((o) => o.toLowerCase() === String(v).toLowerCase())
    if (i >= 0) return i
    if (typeof v === "number" && v >= 0 && v < (k.options?.length ?? 0)) return Math.round(v)
    return `Use one of: ${(k.options ?? []).join(", ")}.`
  }
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

function settle(doc: ForgeDoc, target: string, settings: unknown): { doc: ForgeDoc; problems: string[] } {
  const problems: string[] = []
  if (settings && typeof settings === "object") {
    for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
      const r = setKnob(doc, target, k, v)
      if ("error" in r) problems.push(`${k}: ${r.error}`)
      else doc = r.doc
    }
  }
  return { doc, problems }
}

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Runs one audio tool call. Never throws: problems come back as text for the model to act on. */
export function runAudioTool(doc: ForgeDoc, name: string, args: Record<string, unknown>): ToolOutcome {
  const fail = (result: string): ToolOutcome => ({ doc, result, error: true })
  const done = (d: ForgeDoc, result: string, created?: string[]): ToolOutcome => ({ doc: d, result, created })
  switch (name) {
    case "list_pedals":
      return done(doc, listPedals())
    case "describe_pedal": {
      const types = (Array.isArray(args.types) ? args.types : [args.type]).map(str).filter(Boolean).slice(0, 8)
      if (!types.length) return fail("Give the pedal types to describe.")
      return done(doc, types.map((t) => {
        const spec = pedalSpec(t) ?? modulatorSpec(t)
        return spec ? describePedal(spec) : `No pedal or modulator "${t}".`
      }).join("\n\n"))
    }
    case "view_rack":
      return done(doc, viewRack(doc))
    case "add_pedal": {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(slot)
      const r = rack.addPedal(doc, str(args.type), slot)
      if (isOpError(r)) return fail(`${r.error} Use list_pedals.`)
      const s = settle(r.doc, r.id, args.settings)
      return done(s.doc, `added ${r.id}${s.problems.length ? `; not set: ${s.problems.join("; ")}` : ""}`, [r.id])
    }
    case "add_split": {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(slot)
      const mode = args.mode === "bands" ? "bands" : "parallel"
      const r = rack.addSplit(doc, mode, Number(args.lanes) || 2, slot)
      if (isOpError(r)) return fail(r.error)
      let d = r.doc
      if (args.crossfade) {
        const c = rack.setCrossfade(d, r.id, true)
        if (isOpError(c)) return fail(c.error)
        d = c.doc
      }
      const lanes = (rack.findItem(rack.rackOf(d), r.id)!.item as SplitBlock).lanes.map((l) => l.id)
      return done(d, `added ${r.id} with lanes ${lanes.join(", ")}`, [r.id])
    }
    case "move_pedal": {
      const slot = slotFor(doc, args)
      if (typeof slot === "string") return fail(slot)
      const r = rack.moveItem(doc, str(args.id), slot)
      return isOpError(r) ? fail(r.error) : done(r.doc, "moved")
    }
    case "remove_pedal": {
      if (!rack.findItem(rack.rackOf(doc), str(args.id))) return fail(`No pedal or split "${str(args.id)}".`)
      return done(rack.removeItem(doc, str(args.id)), "removed")
    }
    case "set_knob": {
      const r = setKnob(doc, str(args.target), str(args.knob), args.value)
      return "error" in r ? fail(r.error) : done(r.doc, "set")
    }
    case "add_modulator": {
      const r = rack.addModulator(doc, str(args.type) as Modulator["type"])
      if (isOpError(r)) return fail(r.error)
      let d = r.doc
      if (args.source !== undefined) {
        const before = d
        d = rack.setModulatorSource(d, r.id, str(args.source))
        if (d === before && str(args.source) !== "input") return fail(`No pedal "${str(args.source)}" to follow.`)
      }
      if (Array.isArray(args.steps)) d = rack.setSteps(d, r.id, args.steps.map(Number).filter(Number.isFinite))
      const s = settle(d, r.id, args.settings)
      return done(s.doc, `added ${r.id}${s.problems.length ? `; not set: ${s.problems.join("; ")}` : ""}`)
    }
    case "route_modulation": {
      const r = rack.addRoute(doc, str(args.from), str(args.pedal), str(args.knob), Number(args.depth))
      if (isOpError(r)) return fail(r.error)
      const at = rack.findItem(rack.rackOf(r.doc), str(args.pedal))!
      const k = knobSpec(pedalSpec((at.item as { type: string }).type)!, str(args.knob))!
      return done(r.doc, `route ${r.id}${continuous(k) ? "" : " (a switch)"}`)
    }
    case "set_ir": {
      const at = rack.findItem(rack.rackOf(doc), str(args.pedal))
      if (!at || isSplit(at.item) || at.item.type !== "convolution") return fail("That isn't a convolution pedal.")
      if (!BUILTIN_IRS.some((b) => b.id === args.space)) return fail(`Use one of: ${BUILTIN_IRS.map((b) => b.id).join(", ")}.`)
      return done(rack.setIr(doc, at.item.id, `builtin:${str(args.space)}`), "set")
    }
    case "expose_knob": {
      const path = pathFor(doc, str(args.target), str(args.knob))
      if (typeof path === "string") return fail(path)
      const r = rack.exposeValue(doc, path)
      if (isOpError(r)) return fail(r.error)
      const label = str(args.label).trim().slice(0, 40)
      if (!label) return done(r.doc, `slider ${r.param}`)
      const named = updateParam(r.doc, r.param, { displayName: label })
      return isOpError(named) ? done(r.doc, `slider ${r.param}`) : done(named.doc, `slider ${r.param} "${label}"`)
    }
  }
  return fail(`Unknown tool "${name}".`)
}
