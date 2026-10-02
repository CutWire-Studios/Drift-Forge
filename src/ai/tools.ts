// The tool surface an AI uses to build effects: the hosted chat (Worker), bring-your-own-key chat
// (browser) and the MCP server all run these against a ForgeDoc. Results are short plain text to
// keep token use (and the Workers AI free tier) small.
import { compile } from "@/compiler/compile"
import * as ops from "@/doc/ops"
import { isParamRef, type ForgeDoc, type GradientStop, type InputValue, type Literal, type Rgba } from "@/doc/types"
import { hexToRgba } from "@/doc/util"
import { availableFor, CATEGORIES, nodeDef, NODE_DEFS } from "@/nodes/registry"
import type { CurvePoint, InputDef, NodeDef, OptionDef } from "@/nodes/types"

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object */
  parameters: Record<string, unknown>
}

export interface ToolOutcome {
  doc: ForgeDoc
  result: string
  /** true when the call failed; the model sees the message and can retry */
  error?: boolean
  /** ids of blocks created by this call */
  created?: string[]
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

const blockId = { type: "string", description: "Block id, e.g. n4k2p9a" }
const anyValue = {
  description:
    "Number; [x, y] for points; '#rrggbb' for colours; true/false for switches; option value string for choices; arrays for curves/gradients/labels",
}

export const TOOLS: ToolSpec[] = [
  {
    name: "list_blocks",
    description: "List the block types you can add, grouped by category. Optionally only one category.",
    parameters: obj({ category: { type: "string", description: "e.g. color, distort, three, blur, stylize, generate, mix, transition, animate, math" } }),
  },
  {
    name: "describe_block",
    description: "Show a block type's inputs (with ranges and defaults), outputs and options.",
    parameters: obj({ type: { type: "string" } }, ["type"]),
  },
  {
    name: "view_graph",
    description: "Show the current graph: blocks, their changed settings, connections, sliders and any errors.",
    parameters: obj({}),
  },
  {
    name: "add_block",
    description: "Add a block. Returns its id. Optionally set some of its settings straight away.",
    parameters: obj({ type: { type: "string" }, settings: { type: "object", description: "setting id → value" } }, ["type"]),
  },
  {
    name: "connect",
    description:
      "Wire one block's output into another block's input (replacing any existing wire into that input). Output defaults to the first output; input defaults to the first image input.",
    parameters: obj({ from: blockId, output: { type: "string" }, to: blockId, input: { type: "string" } }, ["from", "to"]),
  },
  {
    name: "disconnect",
    description: "Remove the wire going into a block's input.",
    parameters: obj({ block: blockId, input: { type: "string" } }, ["block", "input"]),
  },
  {
    name: "set_setting",
    description: "Change a block's setting (an unconnected input or an option).",
    parameters: obj({ block: blockId, setting: { type: "string" }, value: anyValue }, ["block", "setting", "value"]),
  },
  {
    name: "remove_block",
    description: "Delete a block and its wires. The Output block can't be removed.",
    parameters: obj({ block: blockId }, ["block"]),
  },
  {
    name: "expose_setting",
    description: "Turn a block's setting into a slider people can change in Drift. Use for the 2–5 settings that matter most.",
    parameters: obj({ block: blockId, setting: { type: "string" }, label: { type: "string", description: "Name shown in Drift" } }, ["block", "setting"]),
  },
  {
    name: "set_details",
    description: "Set the effect's name, description and category shown in Drift.",
    parameters: obj({ name: { type: "string" }, description: { type: "string" }, category: { type: "string" } }),
  },
  {
    name: "check",
    description: "Compile the graph the way Drift will. Returns OK or the problems to fix. Always run before finishing.",
    parameters: obj({}),
  },
]

const fmt = (n: number) => String(Number(n.toFixed(3)))

function describeValue(v: InputValue | unknown): string {
  if (isParamRef(v)) return `slider:${Array.isArray(v.param) ? v.param.join("+") : v.param}`
  if (typeof v === "number") return fmt(v)
  if (typeof v === "boolean") return String(v)
  if (Array.isArray(v)) return `[${v.map((x) => (typeof x === "number" ? fmt(x) : JSON.stringify(x))).join(",")}]`
  return JSON.stringify(v)
}

function inputLine(i: InputDef): string {
  const range = i.min !== undefined ? ` ${fmt(i.min)}..${fmt(i.max ?? 1)}` : ""
  const kind = i.type === "color" ? (i.widget === "swatch" ? "colour" : "image") : i.type === "vec2" ? "point" : "number"
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
    ...def.outputs.map((o) => `  out ${o.id} (${o.type === "color" ? "image" : o.type === "vec2" ? "point" : "number"})`),
    ...(def.options ?? []).map(optionLine),
  ].join("\n")
}

export function viewGraph(doc: ForgeDoc): string {
  const lines = [`${doc.kind} "${doc.meta.displayName}" (${doc.target === "next" ? "next Drift" : "today's Drift"})`]
  for (const n of doc.nodes) {
    const def = nodeDef(n.type)
    if (!def) continue
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
    lines.push(`${n.id} ${n.type}${changed.length ? ` {${changed.join(", ")}}` : ""}`)
  }
  for (const e of doc.edges) lines.push(`${e.from}.${e.fromSocket} -> ${e.to}.${e.toSocket}`)
  if (doc.params.length) lines.push(`sliders: ${doc.params.map((p) => `${p.identifier} "${p.displayName}"`).join(", ")}`)
  const r = compile(doc, { mode: "export" })
  lines.push(r.ok ? "status: OK" : `problems: ${r.errors.map((e) => (e.node ? `${e.node}: ` : "") + e.message).join(" | ")}`)
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
  if (i.type === "vec2") {
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return [v[0], v[1]]
    if (v && typeof v === "object" && "x" in v && "y" in v) return [Number((v as { x: number }).x), Number((v as { y: number }).y)]
    if (typeof v === "number") return [v, v]
    return "Give a point as [x, y]."
  }
  if (typeof v === "boolean") return v ? 1 : 0
  const n = typeof v === "string" ? Number(v) : v
  if (typeof n !== "number" || !Number.isFinite(n)) return "Give a number."
  return n
}

function parseOption(o: OptionDef, v: unknown): unknown | { error: string } {
  switch (o.kind) {
    case "select": {
      const hit = o.options.find((x) => x.value === v || x.label.toLowerCase() === String(v).toLowerCase())
      return hit ? hit.value : { error: `Use one of: ${o.options.map((x) => x.value).join(", ")}.` }
    }
    case "toggle":
      return typeof v === "boolean" ? v : v === "true" || v === 1
    case "number":
      return typeof v === "number" ? Math.min(o.max, Math.max(o.min, v)) : { error: "Give a number." }
    case "code":
      return typeof v === "string" ? v : { error: "Give GLSL code as a string." }
    case "labels":
      return Array.isArray(v) && v.length >= 2 ? v.map(String).slice(0, 8) : { error: "Give at least two choice names." }
    case "region":
      return Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === "number") ? v : { error: "Give [x, y, w, h]." }
    case "curve": {
      if (!Array.isArray(v) || !v.length) return { error: "Give keyframes as [{x, y, ease}]." }
      const eases = ["linear", "smooth", "in", "out", "hold"]
      return v.map(
        (k): CurvePoint => ({
          x: Math.min(1, Math.max(0, Number(k?.x ?? 0))),
          y: Math.min(1, Math.max(0, Number(k?.y ?? 0))),
          ease: eases.includes(k?.ease) ? k.ease : "smooth",
        }),
      )
    }
    case "gradient": {
      if (!Array.isArray(v) || v.length < 2) return { error: "Give at least two stops as [{pos, color}]." }
      const stops: GradientStop[] = []
      for (const s of v) {
        const c = parseColor(s?.color)
        if (!c) return { error: "Each stop needs a '#rrggbb' color." }
        stops.push({ pos: Math.min(1, Math.max(0, Number(s?.pos ?? 0))), color: c })
      }
      return stops
    }
    case "asset":
      return { error: "Pictures can only be chosen in the editor. Ask the user to pick one." }
  }
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

const str = (v: unknown) => (typeof v === "string" ? v : "")

/** Runs one tool call. Never throws: problems come back as text for the model to act on. */
export function runTool(doc: ForgeDoc, name: string, args: Record<string, unknown>): ToolOutcome {
  const fail = (result: string): ToolOutcome => ({ doc, result, error: true })
  try {
    switch (name) {
      case "list_blocks": {
        const cat = str(args.category)
        const defs = NODE_DEFS.filter((d) => !d.output && availableFor(d, doc.kind) && (!cat || d.category === cat))
        if (!defs.length) return fail(`No category "${cat}". Categories: ${CATEGORIES.map((c) => c.id).join(", ")}.`)
        return {
          doc,
          result: CATEGORIES.map((c) => {
            const items = defs.filter((d) => d.category === c.id)
            return items.length ? `${c.id}: ${items.map((d) => `${d.type}${d.next ? "*" : ""}`).join(", ")}` : ""
          })
            .filter(Boolean)
            .join("\n") + (defs.some((d) => d.next) ? "\n(* = next Drift only)" : ""),
        }
      }
      case "describe_block": {
        const def = nodeDef(str(args.type))
        if (!def) return fail(`No block type "${str(args.type)}". Use list_blocks.`)
        return { doc, result: describeBlock(def) }
      }
      case "view_graph":
        return { doc, result: viewGraph(doc) }
      case "add_block": {
        const def = nodeDef(str(args.type))
        if (!def) return fail(`No block type "${str(args.type)}". Use list_blocks.`)
        if (def.output) return fail("The document already has its Output block.")
        if (!availableFor(def, doc.kind)) return fail(`${def.type} can't be used in ${doc.kind === "effect" ? "an effect" : "a transition"}.`)
        const r = ops.addNode(doc, def.type, 0, 0)
        if (ops.isOpError(r)) return fail(r.error)
        let d = r.doc
        const notes: string[] = []
        const settings = args.settings && typeof args.settings === "object" ? (args.settings as Record<string, unknown>) : {}
        for (const [k, v] of Object.entries(settings)) {
          const s = applySetting(d, r.id, k, v)
          if ("error" in s) notes.push(`${k}: ${s.error}`)
          else d = s.doc
        }
        return { doc: d, created: [r.id], result: `added ${r.id} (${def.type})${notes.length ? `; not set: ${notes.join("; ")}` : ""}` }
      }
      case "connect": {
        const from = doc.nodes.find((n) => n.id === str(args.from))
        const to = doc.nodes.find((n) => n.id === str(args.to))
        if (!from || !to) return fail("Unknown block id. Use view_graph to see block ids.")
        const fromDef = nodeDef(from.type)!
        const toDef = nodeDef(to.type)!
        const output = str(args.output) || fromDef.outputs[0]?.id
        const input =
          str(args.input) || (toDef.inputs.find((i) => i.type === "color" && i.widget !== "swatch") ?? toDef.inputs[0])?.id
        if (!output) return fail(`${from.type} has no outputs.`)
        if (!input) return fail(`${to.type} has no inputs.`)
        const r = ops.connect(doc, from.id, output, to.id, input)
        if (ops.isOpError(r)) return fail(r.error)
        return { doc: r.doc, result: `connected ${from.id}.${output} -> ${to.id}.${input}` }
      }
      case "disconnect": {
        const e = doc.edges.find((e) => e.to === str(args.block) && e.toSocket === str(args.input))
        if (!e) return fail("Nothing is connected there.")
        return { doc: ops.disconnect(doc, [e.id]), result: "disconnected" }
      }
      case "set_setting": {
        const r = applySetting(doc, str(args.block), str(args.setting), args.value)
        return "error" in r ? fail(r.error) : { doc: r.doc, result: "ok" }
      }
      case "remove_block": {
        const n = doc.nodes.find((n) => n.id === str(args.block))
        if (!n) return fail("Unknown block id.")
        if (nodeDef(n.type)?.output) return fail("The Output block can't be removed.")
        return { doc: ops.removeNodes(doc, [n.id]), result: `removed ${n.id}` }
      }
      case "expose_setting": {
        const node = doc.nodes.find((n) => n.id === str(args.block))
        if (!node) return fail("Unknown block id.")
        const def = nodeDef(node.type)!
        const setting = str(args.setting)
        const label = str(args.label) || undefined
        if (def.inputs.some((i) => i.id === setting)) {
          if (doc.edges.some((e) => e.to === node.id && e.toSocket === setting)) return fail(`${setting} is connected; disconnect it first.`)
          const r = ops.expose(doc, node.id, setting, label)
          if (ops.isOpError(r)) return fail(r.error)
          return { doc: r.doc, result: `slider ${r.params.join(", ")}` }
        }
        if (def.options?.some((o) => o.id === setting)) {
          const r = ops.exposeOption(doc, node.id, setting)
          if (ops.isOpError(r)) return fail(r.error)
          let d = r.doc
          if (label) {
            const u = ops.updateParam(d, r.param, { displayName: label })
            if (!ops.isOpError(u)) d = u.doc
          }
          return { doc: d, result: `slider ${r.param}` }
        }
        return fail(`${def.type} has no setting "${setting}".`)
      }
      case "set_details": {
        let d = doc
        const meta = { ...d.meta }
        if (str(args.name)) meta.displayName = str(args.name).slice(0, 60)
        if (str(args.description)) meta.description = str(args.description).slice(0, 300)
        if (str(args.category)) meta.category = str(args.category).slice(0, 30)
        d = { ...d, meta }
        return { doc: d, result: "ok" }
      }
      case "check": {
        const r = compile(doc, { mode: "export" })
        return {
          doc,
          result: r.ok
            ? `OK (${r.passes.length} pass${r.passes.length > 1 ? "es" : ""})`
            : `problems: ${r.errors.map((e) => (e.node ? `${e.node}: ` : "") + e.message).join(" | ")}`,
          error: !r.ok,
        }
      }
      default:
        return fail(`Unknown tool "${name}".`)
    }
  } catch (e) {
    return fail(`That failed: ${(e as Error).message}`)
  }
}
