import { z } from "zod"
import type { ForgeDoc, Kind } from "@/core/doc/types"

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

export interface Tool {
  spec: ToolSpec
  /** the document kinds it builds */
  kinds: readonly Kind[]
  /** Never throws for bad arguments: they come back as an error outcome. */
  call(doc: ForgeDoc, args: Record<string, unknown>): ToolOutcome
}

export const VIDEO_KINDS: readonly Kind[] = ["effect", "transition"]
export const AUDIO_KINDS: readonly Kind[] = ["audio"]
export const ALL_KINDS: readonly Kind[] = ["effect", "transition", "audio"]

export const isShared = (t: Tool) => ALL_KINDS.every((k) => t.kinds.includes(k))

/** The arguments' JSON Schema as providers send it: no $schema, always a `required` list. */
export function jsonSchema(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input" })
  return { ...rest, required: rest.required ?? [] }
}

export function defineTool<S extends z.ZodObject>(t: {
  name: string
  description: string
  schema: S
  kinds: readonly Kind[]
  run(doc: ForgeDoc, args: z.output<S>): ToolOutcome
}): Tool {
  return {
    spec: { name: t.name, description: t.description, parameters: jsonSchema(t.schema) },
    kinds: t.kinds,
    call(doc, args) {
      const parsed = t.schema.safeParse(args)
      if (!parsed.success) return fail(doc, `Bad arguments for ${t.name}: ${z.prettifyError(parsed.error)}`)
      return t.run(doc, parsed.data)
    },
  }
}

export const fail = (doc: ForgeDoc, result: string): ToolOutcome => ({ doc, result, error: true })

export const fmt = (n: number) => String(Number(n.toFixed(3)))
