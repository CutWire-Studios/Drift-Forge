// Pure edits on a ForgeDoc. The editor store, the AI tool executor (browser and Worker) and the
// MCP server all go through these, so a graph built by an AI behaves exactly like one built by hand.
export { isOpError, type OpResult } from "./result"
export * from "./graph"
export * from "./params"
