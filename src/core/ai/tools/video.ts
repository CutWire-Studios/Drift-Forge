// The tools an AI builds video effects and transitions with. Results are short plain text to keep
// token use (and the Workers AI free tier) small.
import { z } from "zod"
import { compile } from "@/core/compiler/compile"
import { KIND_INFO } from "@/core/doc/kinds"
import { isParamRef, type ForgeDoc, type ForgeNode, type GradientStop, type InputValue, type Literal, type Rgba, type SocketType, type Vec2 } from "@/core/doc/types"
import { hexToRgba } from "@/core/doc/util"
import * as ops from "@/core/edit/ops"
import { availableFor, CATEGORIES, nodeDef, NODE_DEFS } from "@/core/nodes/registry"
import type { CurvePoint, InputDef, NodeDef, OptionDef } from "@/core/nodes/types"
import { defineTool, fail, fmt, VIDEO_KINDS } from "./define"
import { problemsText } from "./shared"

const SOCKET_WORD: Record<SocketType, string> = { color: "image", vec2: "point", float: "number" }

const blockId = z.string().describe("Block id, e.g. n4k2p9a")
const settings = (what: string) => z.record(z.string(), z.unknown()).describe(`${what} id → value`).optional()

function describeValue(v: InputValue | unknown): string {
  if (isParamRef(v)) return `slider:${Array.isArray(v.param) ? v.param.join("+") : v.param}`
  if (typeof v === "number") return fmt(v)
  if (typeof v === "boolean") return String(v)
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "number" ? fmt(x) : JSON.stringify(x))).join(",")}]`
  return JSON.stringify(v)
}

function inputLine(i: InputDef): string {
  const range = i.min !== undefined ? ` ${fmt(i.min)}..${fmt(i.max ?? 1)}` : ""
  const kind = i.type === "color" && i.widget === "swatch" ? "colour" : SOCKET_WORD[i.type]
  const extra = i.clock ? " (follows time/progress when unconnected)" : ""
  return `  in ${i.id} (${kind}${range}, default ${describeValue(i.default)})${extra}: ${i.label}`
}

function optionLine(o: OptionDef): string {
  if (o.kind === "select") return `  option ${o.id}: one of ${o.options.map((x) => x.value).join("|")} (default ${o.default})`
  if (o.kind === "toggle") return `  option ${o.id}: true/false (default ${o.default})`
  if (o.kind === "number") return `  option ${o.id}: ${o.min}..${o.max}`
  if (o.kind === "curve") return `  option ${o.id}: keyframes [{x 0..1, y 0..1, ease linear|smooth|in|out|hold}]`
  if (o.kind === "gradient") return `  option ${o.id}: stops [{pos 0..1, color '#rrggbb'}]`
  if (o.kind === "region") return `  option ${o.id}: [x, y, w, h] in 0..1`
  if (o.kind === "labels") return `  option ${o.id}: list of choice names`
  if (o.kind === "code") return `  option ${o.id}: GLSL function body returning vec4`
  return `  option ${o.id}: uploaded picture (ask the user to pick one in the editor)`
}

export function describeBlock(def: NodeDef): string {
  return [
    `${def.type} — ${def.label}: ${def.description}`,
    ...def.inputs.map(inputLine),
    ...def.outputs.map((o) => `  out ${o.id} (${SOCKET_WORD[o.type]})`),
    ...(def.options ?? []).map(optionLine),
  ].join("\n")
}

/** A block's inputs and options that differ from their defaults, as `id=value`. */
function changedSettings(n: ForgeNode, def: NodeDef): string[] {
  const changed: string[] = []
  for (const i of def.inputs) {
    const v = n.inputs[i.id]
    if (v !== undefined && JSON.stringify(v) !== JSON.stringify(i.default)) changed.push(`${i.id}=${describeValue(v)}`)
  }
  for (const o of def.options ?? []) {
    const v = n.data[o.id]
    if (v !== undefined && "default" in o && JSON.stringify(v) !== JSON.stringify(o.default)) {
      changed.push(`${o.id}=${o.kind === "code" ? "(code)" : describeValue(v)}`)
    }
  }
  return changed
}

export function viewBlocks(doc: ForgeDoc): string {
  const lines = [`${doc.kind} "${doc.meta.displayName}"`]
  for (const n of doc.nodes) {
    const def = nodeDef(n.type)
    if (!def) continue
    const changed = changedSettings(n, def)
    lines.push(`${n.id} ${n.type}${changed.length ? ` {${changed.join(", ")}}` : ""}`)
  }
  for (const e of doc.edges) lines.push(`${e.from}.${e.fromSocket} -> ${e.to}.${e.toSocket}`)
  if (doc.params.length) lines.push(`sliders: ${doc.params.map((p) => `${p.identifier} "${p.displayName}"`).join(", ")}`)
  const r = compile(doc, { mode: "export" })
  lines.push(r.ok ? "status: OK" : problemsText(r))
  return lines.join("\n")
}

function parseColor(v: unknown): Rgba | null {
  if (typeof v === "string" && /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v.trim())) {
    return hexToRgba(v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`)
  }
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) {
    const s = v.some((x) => x > 1) ? 255 : 1
    return [v[0] / s, v[1] / s, v[2] / s, v.length > 3 ? v[3] / (v[3] > 1 ? 255 : 1) : 1]
  }
  return null
}

function parseInput(i: InputDef, v: unknown): Literal | string {
  if (i.type === "color") {
    if (i.widget !== "swatch") return "That input takes an image; connect a block to it instead."
    return parseColor(v) ?? "Give a colour as '#rrggbb'."
  }
  if (i.type === "vec2") return parsePoint(v)
  return parseNumber(v)
}

function parsePoint(v: unknown): Vec2 | string {
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return [v[0], v[1]]
  if (v && typeof v === "object" && "x" in v && "y" in v) return [Number((v as { x: number }).x), Number((v as { y: number }).y)]
  if (typeof v === "number") return [v, v]
  return "Give a point as [x, y]."
}

function parseNumber(v: unknown): number | string {
  if (typeof v === "boolean") return v ? 1 : 0
  const n = typeof v === "string" ? Number(v) : v
  if (typeof n !== "number" || !Number.isFinite(n)) return "Give a number."
  return n
}

type OptionValue = unknown | { error: string }

const CURVE_EASES = ["linear", "smooth", "in", "out", "hold"]
const unit = (x: unknown) => Math.min(1, Math.max(0, Number(x ?? 0)))

function parseCurve(v: unknown): OptionValue {
  if (!Array.isArray(v) || !v.length) return { error: "Give keyframes as [{x, y, ease}]." }
  return v.map((k): CurvePoint => ({ x: unit(k?.x), y: unit(k?.y), ease: CURVE_EASES.includes(k?.ease) ? k.ease : "smooth" }))
}

function parseGradient(v: unknown): OptionValue {
  if (!Array.isArray(v) || v.length < 2) return { error: "Give at least two stops as [{pos, color}]." }
  const stops: GradientStop[] = []
  for (const s of v) {
    const c = parseColor(s?.color)
    if (!c) return { error: "Each stop needs a '#rrggbb' color." }
    stops.push({ pos: unit(s?.pos), color: c })
  }
  return stops
}

const OPTION_PARSERS: { [K in OptionDef["kind"]]: (o: Extract<OptionDef, { kind: K }>, v: unknown) => OptionValue } = {
  select: (o, v) => {
    const hit = o.options.find((x) => x.value === v || x.label.toLowerCase() === String(v).toLowerCase())
    return hit ? hit.value : { error: `Use one of: ${o.options.map((x) => x.value).join(", ")}.` }
  },
  toggle: (_, v) => (typeof v === "boolean" ? v : v === "true" || v === 1),
  number: (o, v) => (typeof v === "number" ? Math.min(o.max, Math.max(o.min, v)) : { error: "Give a number." }),
  code: (_, v) => (typeof v === "string" ? v : { error: "Give GLSL code as a string." }),
  labels: (_, v) => (Array.isArray(v) && v.length >= 2 ? v.map(String).slice(0, 8) : { error: "Give at least two choice names." }),
  region: (_, v) => (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number") ? v : { error: "Give [x, y, w, h]." }),
  curve: (_, v) => parseCurve(v),
  gradient: (_, v) => parseGradient(v),
  asset: () => ({ error: "Pictures can only be chosen in the editor. Ask the user to pick one." }),
}

function parseOption(o: OptionDef, v: unknown): OptionValue {
  return (OPTION_PARSERS[o.kind] as (o: OptionDef, v: unknown) => OptionValue)(o, v)
}

function applySetting(doc: ForgeDoc, nodeId: string, setting: string, value: unknown): { doc: ForgeDoc } | { error: string } {
  const node = doc.nodes.find((n) => n.id === nodeId)
  if (!node) return { error: `No block "${nodeId}". Use view_graph to see block ids.` }
  const def = nodeDef(node.type)!
  const input = def.inputs.find((i) => i.id === setting)
  if (input) {
    if (doc.edges.some((e) => e.to === nodeId && e.toSocket === setting)) {
      return { error: `${setting} is connected to another block; disconnect it first.` }
    }
    if (isParamRef(node.inputs[setting])) return { error: `${setting} is a Drift slider; its default is set by the user.` }
    const v = parseInput(input, value)
    if (typeof v === "string") return { error: v }
    return { doc: ops.setInput(doc, nodeId, setting, v) }
  }
  const option = def.options?.find((o) => o.id === setting)
  if (option) {
    const v = parseOption(option, value)
    if (v && typeof v === "object" && "error" in v) return v as { error: string }
    return { doc: ops.setData(doc, nodeId, setting, v) }
  }
  const names = [...def.inputs.map((i) => i.id), ...(def.options ?? []).map((o) => o.id)]
  return { error: `${def.type} has no setting "${setting}". It has: ${names.join(", ")}.` }
}

function addBlock(doc: ForgeDoc, type: string, settings: Record<string, unknown> = {}) {
  const def = nodeDef(type)
  if (!def) return fail(doc, `No block type "${type}". Use list_blocks.`)
  if (def.output) return fail(doc, "The document already has its Output block.")
  if (!availableFor(def, doc.kind)) return fail(doc, `${def.type} can't be used in ${KIND_INFO[doc.kind].withArticle}.`)
  const r = ops.addNode(doc, def.type, 0, 0)
  if (ops.isOpError(r)) return fail(doc, r.error)
  let d = r.doc
  const notes: string[] = []
  for (const [k, v] of Object.entries(settings)) {
    const s = applySetting(d, r.id, k, v)
    if ("error" in s) notes.push(`${k}: ${s.error}`)
    else d = s.doc
  }
  return { doc: d, created: [r.id], result: `added ${r.id} (${def.type})${notes.length ? `; not set: ${notes.join("; ")}` : ""}` }
}

function connectBlocks(doc: ForgeDoc, args: { from: string; output?: string; to: string; input?: string }) {
  const from = doc.nodes.find((n) => n.id === args.from)
  const to = doc.nodes.find((n) => n.id === args.to)
  if (!from || !to) return fail(doc, "Unknown block id. Use view_graph to see block ids.")
  const fromDef = nodeDef(from.type)!
  const toDef = nodeDef(to.type)!
  const output = args.output || fromDef.outputs[0]?.id
  const input = args.input || (toDef.inputs.find((i) => i.type === "color" && i.widget !== "swatch") ?? toDef.inputs[0])?.id
  if (!output) return fail(doc, `${from.type} has no outputs.`)
  if (!input) return fail(doc, `${to.type} has no inputs.`)
  const r = ops.connect(doc, from.id, output, to.id, input)
  if (ops.isOpError(r)) return fail(doc, r.error)
  return { doc: r.doc, result: `connected ${from.id}.${output} -> ${to.id}.${input}` }
}

function exposeSetting(doc: ForgeDoc, block: string, setting: string, label?: string) {
  const node = doc.nodes.find((n) => n.id === block)
  if (!node) return fail(doc, "Unknown block id.")
  const def = nodeDef(node.type)!
  if (def.inputs.some((i) => i.id === setting)) {
    if (doc.edges.some((e) => e.to === node.id && e.toSocket === setting)) return fail(doc, `${setting} is connected; disconnect it first.`)
    const r = ops.expose(doc, node.id, setting, label)
    if (ops.isOpError(r)) return fail(doc, r.error)
    return { doc: r.doc, result: `slider ${r.params.join(", ")}` }
  }
  if (def.options?.some((o) => o.id === setting)) {
    const r = ops.exposeOption(doc, node.id, setting)
    if (ops.isOpError(r)) return fail(doc, r.error)
    let d = r.doc
    if (label) {
      const u = ops.updateParam(d, r.param, { displayName: label })
      if (!ops.isOpError(u)) d = u.doc
    }
    return { doc: d, result: `slider ${r.param}` }
  }
  return fail(doc, `${def.type} has no setting "${setting}".`)
}

export const VIDEO_TOOLS = [
  defineTool({
    name: "list_blocks",
    description: "List the block types you can add, grouped by category. Optionally only one category.",
    schema: z.strictObject({ category: z.string().describe("e.g. color, distort, three, blur, stylize, generate, mix, transition, animate, math").optional() }),
    kinds: VIDEO_KINDS,
    run: (doc, { category = "" }) => {
      const defs = NODE_DEFS.filter((d) => !d.output && availableFor(d, doc.kind) && (!category || d.category === category))
      if (!defs.length) return fail(doc, `No category "${category}". Categories: ${CATEGORIES.map((c) => c.id).join(", ")}.`)
      const result = CATEGORIES.map((c) => {
        const items = defs.filter((d) => d.category === c.id)
        return items.length ? `${c.id}: ${items.map((d) => d.type).join(", ")}` : ""
      })
        .filter(Boolean)
        .join("\n")
      return { doc, result }
    },
  }),
  defineTool({
    name: "describe_block",
    description: "Show the inputs (with ranges and defaults), outputs and options of one or more block types. Ask for all the blocks you need at once.",
    schema: z.strictObject({ types: z.array(z.string()).max(8) }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => {
      const types = args.types.filter(Boolean)
      if (!types.length) return fail(doc, "Give the block types to describe.")
      const result = types
        .map((t) => {
          const def = nodeDef(t)
          return def ? describeBlock(def) : `No block type "${t}".`
        })
        .join("\n\n")
      return { doc, result }
    },
  }),
  defineTool({
    name: "view_graph",
    description: "Show the current graph: blocks, their changed settings, connections, sliders and any errors.",
    schema: z.strictObject({}),
    kinds: VIDEO_KINDS,
    run: (doc) => ({ doc, result: viewBlocks(doc) }),
  }),
  defineTool({
    name: "add_block",
    description: "Add a block. Returns its id. Optionally set some of its settings straight away.",
    schema: z.strictObject({ type: z.string(), settings: settings("setting") }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => addBlock(doc, args.type, args.settings),
  }),
  defineTool({
    name: "connect",
    description:
      "Wire one block's output into another block's input (replacing any existing wire into that input). Output defaults to the first output; input defaults to the first image input.",
    schema: z.strictObject({ from: blockId, output: z.string().optional(), to: blockId, input: z.string().optional() }),
    kinds: VIDEO_KINDS,
    run: connectBlocks,
  }),
  defineTool({
    name: "disconnect",
    description: "Remove the wire going into a block's input.",
    schema: z.strictObject({ block: blockId, input: z.string() }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => {
      const e = doc.edges.find((e) => e.to === args.block && e.toSocket === args.input)
      if (!e) return fail(doc, "Nothing is connected there.")
      return { doc: ops.disconnect(doc, [e.id]), result: "disconnected" }
    },
  }),
  defineTool({
    name: "set_setting",
    description: "Change a block's setting (an unconnected input or an option).",
    schema: z.strictObject({
      block: blockId,
      setting: z.string(),
      value: z
        .unknown()
        .describe(
          "Number; [x, y] for points; '#rrggbb' for colours; true/false for switches; option value string for choices; arrays for curves/gradients/labels",
        ),
    }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => {
      const r = applySetting(doc, args.block, args.setting, args.value)
      return "error" in r ? fail(doc, r.error) : { doc: r.doc, result: "ok" }
    },
  }),
  defineTool({
    name: "remove_block",
    description: "Delete a block and its wires. The Output block can't be removed.",
    schema: z.strictObject({ block: blockId }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => {
      const n = doc.nodes.find((n) => n.id === args.block)
      if (!n) return fail(doc, "Unknown block id.")
      if (nodeDef(n.type)?.output) return fail(doc, "The Output block can't be removed.")
      return { doc: ops.removeNodes(doc, [n.id]), result: `removed ${n.id}` }
    },
  }),
  defineTool({
    name: "expose_setting",
    description: "Turn a block's setting into a slider people can change in Drift. Use for the 2–5 settings that matter most.",
    schema: z.strictObject({ block: blockId, setting: z.string(), label: z.string().describe("Name shown in Drift").optional() }),
    kinds: VIDEO_KINDS,
    run: (doc, args) => exposeSetting(doc, args.block, args.setting, args.label || undefined),
  }),
]
