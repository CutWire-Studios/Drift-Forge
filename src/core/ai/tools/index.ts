// The tool surface an AI uses to build documents: the hosted chat (server), bring-your-own-key chat
// (browser) and the MCP server all run these against a ForgeDoc.
import type { ForgeDoc, Kind } from "@/core/doc/types"
import { errorMessage } from "@/core/errors"
import { AUDIO_TOOLS, viewRack } from "./audio"
import { CONVERSATION_TOOLS } from "./conversation"
import { fail, isShared, type Tool, type ToolOutcome, type ToolSpec } from "./define"
import { SHARED_TOOLS } from "./shared"
import { VIDEO_TOOLS, viewBlocks } from "./video"

export { isShared, type Tool, type ToolOutcome, type ToolSpec } from "./define"
export { conversationTool, type ConversationTool, type Pending, type Plan, type Question } from "./conversation"

/** Every build tool, in the order models and MCP clients are shown them. */
export const BUILD_TOOLS: Tool[] = [...VIDEO_TOOLS, ...SHARED_TOOLS, ...AUDIO_TOOLS]
const BY_NAME = new Map(BUILD_TOOLS.map((t) => [t.spec.name, t]))

const WRONG_KIND: Record<Kind, string> = {
  audio: "This is an audio effect: build it with the pedal tools (list_pedals, view_rack, add_pedal…).",
  effect: "These tools are for audio effects; this is a video document, built with blocks.",
  transition: "These tools are for audio effects; this is a video document, built with blocks.",
}

const VIEW: Record<Kind, (doc: ForgeDoc) => string> = { effect: viewBlocks, transition: viewBlocks, audio: viewRack }

export const viewGraph = (doc: ForgeDoc) => VIEW[doc.kind](doc)

/** Runs one tool call. Never throws: problems come back as text for the model to act on. */
export function runTool(doc: ForgeDoc, name: string, args: Record<string, unknown>): ToolOutcome {
  const tool = BY_NAME.get(name)
  if (!tool) return fail(doc, doc.kind === "audio" ? WRONG_KIND.audio : `Unknown tool "${name}".`)
  if (!tool.kinds.includes(doc.kind)) return fail(doc, WRONG_KIND[doc.kind])
  try {
    return tool.call(doc, args)
  } catch (e) {
    return fail(doc, `That failed: ${errorMessage(e)}`)
  }
}

/** The tools that build a document of this kind: its own first, then the shared ones. */
export function toolsFor(kind: Kind): ToolSpec[] {
  const own = BUILD_TOOLS.filter((t) => t.kinds.includes(kind) && !isShared(t))
  return [...own, ...BUILD_TOOLS.filter(isShared)].map((t) => t.spec)
}

/** Everything the built-in assistant can call on a document of this kind. */
export function agentTools(kind: Kind): ToolSpec[] {
  return [...toolsFor(kind), ...CONVERSATION_TOOLS.map((t) => t.spec)]
}
