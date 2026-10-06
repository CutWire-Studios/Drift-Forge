// Tools every kind of document is built with.
import { z } from "zod"
import { compile, type CompileResult } from "@/core/compiler/compile"
import type { ForgeDoc } from "@/core/doc/types"
import { ALL_KINDS, defineTool } from "./define"

export const problemsText = (r: CompileResult) => `problems: ${r.errors.map((e) => (e.node ? `${e.node}: ` : "") + e.message).join(" | ")}`

function okText(doc: ForgeDoc, r: CompileResult): string {
  if (doc.kind === "audio") return "OK"
  return `OK (${r.passes.length} pass${r.passes.length > 1 ? "es" : ""})`
}

export const SHARED_TOOLS = [
  defineTool({
    name: "set_details",
    description: "Set the effect's name, description and category shown in Drift.",
    schema: z.strictObject({ name: z.string().optional(), description: z.string().optional(), category: z.string().optional() }),
    kinds: ALL_KINDS,
    run: (doc, args) => {
      const meta = { ...doc.meta }
      if (args.name) meta.displayName = args.name.slice(0, 60)
      if (args.description) meta.description = args.description.slice(0, 300)
      if (args.category) meta.category = args.category.slice(0, 30)
      return { doc: { ...doc, meta }, result: "ok" }
    },
  }),
  defineTool({
    name: "check",
    description: "Compile the graph the way Drift will. Returns OK or the problems to fix. Always run before finishing.",
    schema: z.strictObject({}),
    kinds: ALL_KINDS,
    run: (doc) => {
      const r = compile(doc, { mode: "export" })
      return { doc, result: r.ok ? okText(doc, r) : problemsText(r), error: !r.ok }
    },
  }),
]
