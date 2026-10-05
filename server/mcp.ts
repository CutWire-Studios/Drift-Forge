// Remote MCP server: outside AI tools (Claude, Cursor…) build Forge effects with their own model.
// It never calls Workers AI, so it costs no AI credits. Documents live here for a week under an
// unguessable doc_id and leave as a share link that opens in Forge.
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server"
import { placeNew } from "@/ai/layout"
import { AUDIO_TOOLS } from "@/ai/audioTools"
import { runTool, TOOLS, viewGraph } from "@/ai/tools"
import { compile } from "@/compiler/compile"
import { packageJson, packageJsonName } from "@/compiler/manifest"
import type { ForgeDoc } from "@/doc/types"
import { makeEffectId } from "@/doc/util"
import { decodeLinkPayload, encodeLinkPayload, LINK_LIMIT, parseForgeDoc } from "@/export/link"
import { STARTERS } from "@/starters"
import { AUDIO_STARTERS } from "@/starters/audio"
import { config } from "./config"
import type { Ledger } from "./db"

const DOC_TTL = 7 * 86_400_000
const MAX_DOC = 512 * 1024

const schema = <T,>(s: object) => fromJsonSchema<T>(s as JsonSchemaType)

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) })

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }

const withDocId = (s: Record<string, unknown>): Schema => {
  const schema = s as Schema
  return {
    ...schema,
    properties: { doc_id: { type: "string", description: "From new_document or open_link" }, ...schema.properties },
    required: ["doc_id", ...(schema.required ?? [])],
  }
}

export function mcpHandler(ledger: Ledger) {
  const load = (id: unknown): { doc: ForgeDoc; unplaced: string[] } | null => {
    const row = typeof id === "string" ? ledger.getDoc(id) : null
    return row ? { doc: parseForgeDoc(row.json), unplaced: row.unplaced } : null
  }
  const save = (id: string, doc: ForgeDoc, unplaced: string[]): string | null => {
    const json = JSON.stringify(doc)
    if (json.length > MAX_DOC) return "The document is too large to keep."
    ledger.putDoc(id, json, unplaced, DOC_TTL)
    return null
  }
  const store = (doc: ForgeDoc) => {
    ledger.sweep()
    const id = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url")
    const err = save(id, doc, [])
    return err ? text(err, true) : text(`doc_id: ${id}\n${viewGraph(doc)}`)
  }

  const factory = () => {
    const server = new McpServer({ name: "drift-forge", version: "1.0.0" })

    server.registerTool(
      "new_document",
      {
        description:
          "Start a new Drift video effect, transition or audio effect. Optionally begin from a starter. Returns a doc_id for the other tools. Effects start from the Video block; transitions from From/To/Progress; audio effects are a pedalboard built with the audio tools.",
        inputSchema: schema<{ kind: "effect" | "transition" | "audio"; name?: string; starter?: string }>({
          type: "object",
          properties: {
            kind: { type: "string", enum: ["effect", "transition", "audio"] },
            name: { type: "string" },
            starter: { type: "string", description: `One of: ${[...STARTERS, ...AUDIO_STARTERS].map((s) => s.name).join(", ")}` },
          },
          required: ["kind"],
          additionalProperties: false,
        }),
      },
      async (args: { kind: "effect" | "transition" | "audio"; name?: string; starter?: string }) => {
        const starters = [...STARTERS, ...AUDIO_STARTERS]
        const pick =
          starters.find((s) => s.doc.kind === args.kind && s.name.toLowerCase() === (args.starter ?? "").toLowerCase()) ??
          starters.find((s) => s.doc.kind === args.kind && s.name.startsWith("Blank"))!
        const doc = structuredClone(pick.doc)
        if (args.name) doc.meta.displayName = args.name.slice(0, 60)
        doc.meta.id = makeEffectId(doc.meta.displayName)
        return store(doc)
      },
    )

    server.registerTool(
      "open_link",
      {
        description: "Open a Drift Forge share link (https://forge.cutwire.org/#v1.…) for editing. Returns a doc_id.",
        inputSchema: schema<{ url: string }>({ type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false }),
      },
      async (args: { url: string }) => {
        try {
          return store(await decodeLinkPayload(args.url.slice(args.url.indexOf("#") + 1)))
        } catch (e) {
          return text((e as Error).message, true)
        }
      },
    )

    // Both tool sets are offered; each says which kind of document it builds, and the other kind's
    // tools refuse with a pointer to the right ones.
    const shared = new Set(["set_details", "check"])
    const forKind = (name: string, audio: boolean) => (shared.has(name) ? "" : audio ? "(Audio effects.) " : "(Video effects and transitions.) ")
    for (const tool of [...TOOLS.map((t) => ({ t, audio: false })), ...AUDIO_TOOLS.map((t) => ({ t, audio: true }))].map(({ t, audio }) => ({ ...t, description: forKind(t.name, audio) + t.description }))) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: schema<Record<string, unknown>>(withDocId(tool.parameters)) },
        async (args: Record<string, unknown>) => {
          const cur = load(args.doc_id)
          if (!cur) return text("Unknown or expired doc_id. Start with new_document or open_link.", true)
          const { doc_id: _id, ...rest } = args
          const r = runTool(cur.doc, tool.name, rest)
          if (r.doc !== cur.doc) {
            const err = save(String(args.doc_id), r.doc, [...cur.unplaced, ...(r.created ?? [])])
            if (err) return text(err, true)
          }
          return text(r.result, !!r.error)
        },
      )
    }

    server.registerTool(
      "get_share_link",
      {
        description: "Get a link that opens this effect in Drift Forge, where it can be previewed, tweaked and exported for Drift.",
        inputSchema: schema<{ doc_id: string }>(withDocId({ type: "object", properties: {} })),
      },
      async (args: { doc_id: string }) => {
        const cur = load(args.doc_id)
        if (!cur) return text("Unknown or expired doc_id.", true)
        const doc = placeNew(cur.doc, new Set(cur.unplaced))
        save(args.doc_id, doc, [])
        const url = `${config.publicUrl}/#${await encodeLinkPayload(doc)}`
        return url.length > LINK_LIMIT ? text(`The link would be ${url.length} characters, over the ${LINK_LIMIT} limit.`, true) : text(url)
      },
    )

    server.registerTool(
      "get_shader_code",
      {
        description: "Show what Drift will run for this document: effect.json/transition.json and its GLSL, or an audio effect's audio-effect.json.",
        inputSchema: schema<{ doc_id: string }>(withDocId({ type: "object", properties: {} })),
      },
      async (args: { doc_id: string }) => {
        const cur = load(args.doc_id)
        if (!cur) return text("Unknown or expired doc_id.", true)
        const r = compile(cur.doc, { mode: "export" })
        if (!r.ok) return text(`problems: ${r.errors.map((e) => e.message).join(" | ")}`, true)
        const out = [
          `// ${packageJsonName(cur.doc)}`,
          JSON.stringify(packageJson(cur.doc, r), null, 2),
          ...r.passes.flatMap((p) => [`// ${p.file}`, p.source]),
        ].join("\n\n")
        return text(out.slice(0, 40_000))
      },
    )

    return server
  }

  return createMcpHandler(factory)
}
