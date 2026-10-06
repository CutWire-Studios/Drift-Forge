import { pendingAsText, type AgentEvent, type ChatTurn, type Pending } from "@/core/ai/agent"
import { create } from "zustand"

export type Line =
  | { role: "user" | "error"; text: string }
  /** `live` while the model is still writing it */
  | { role: "assistant" | "thinking"; text: string; live?: boolean }
  | { role: "tool"; text: string; error?: boolean }
  | { role: "pending"; pending: Pending }

/** Conversations per document, kept for this tab only. */
export const useChats = create<{ chats: Record<string, Line[]> }>(() => ({ chats: {} }))

/** The plain-text conversation the model sees next time: reasoning and tool progress are left out. */
export function historyOf(lines: Line[]): ChatTurn[] {
  return lines.flatMap((l): ChatTurn[] => {
    if (l.role === "user" || l.role === "assistant") return [{ role: l.role, text: l.text }]
    if (l.role === "pending") return [{ role: "assistant", text: pendingAsText(l.pending) }]
    return []
  })
}

/** Marks every streamed line finished. */
export const settle = (ls: Line[]): Line[] => ls.map((l) => (l.role === "assistant" || l.role === "thinking" ? { ...l, live: false } : l))

const TOOL_LABELS: Record<string, string> = {
  list_blocks: "Looked through the blocks",
  describe_block: "Read about a block",
  view_graph: "Looked at the graph",
  add_block: "Added a block",
  remove_block: "Removed a block",
  connect: "Connected blocks",
  disconnect: "Disconnected an input",
  set_setting: "Changed a setting",
  set_option: "Changed an option",
  expose_setting: "Added a slider",
  set_details: "Named it",
  check: "Checked the result",
  list_pedals: "Looked through the pedals",
  describe_pedal: "Read about a pedal",
  view_rack: "Looked at the board",
  add_pedal: "Added a pedal",
  add_split: "Added a split",
  move_pedal: "Moved a pedal",
  remove_pedal: "Removed a pedal",
  set_knob: "Turned a knob",
  add_modulator: "Added a modulator",
  route_modulation: "Routed a modulator",
  set_ir: "Chose a space",
  expose_knob: "Added a slider",
}

type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>

const EVENT_LINES: { [T in AgentEvent["type"]]: (ls: Line[], e: EventOf<T>) => Line[] } = {
  delta: (ls, e) => {
    const role = e.channel === "thinking" ? "thinking" : "assistant"
    const last = ls.at(-1)
    if (last && last.role === role && last.live) return [...ls.slice(0, -1), { ...last, text: last.text + e.text }]
    return [...ls, { role, text: e.text, live: true }]
  },
  thinking: (ls, e) => [...ls, { role: "thinking", text: e.text }],
  text: (ls, e) => [...ls, { role: "assistant", text: e.text }],
  tool: (ls, e) => {
    const label = TOOL_LABELS[e.name] ?? e.name
    return [...ls, { role: "tool", text: e.error ? `${label}: ${e.result}` : label, error: e.error }]
  },
  pending: (ls) => ls,
}

/** The status line an event switches to, for those that change it. */
export const EVENT_BUSY: Partial<Record<AgentEvent["type"], string | null>> = { delta: null, tool: "Working…" }

export function applyEvent(ls: Line[], e: AgentEvent): Line[] {
  // TypeScript can't correlate EVENT_LINES[e.type] with e across the union, so the one cast lives here.
  return (EVENT_LINES[e.type] as (ls: Line[], e: AgentEvent) => Line[])(ls, e)
}

/** The log once a run ends: a reply that streamed in is already on screen, so it's settled instead of added again. */
export function finish(ls: Line[], reply: string, pending: Pending | undefined): Line[] {
  const last = ls.at(-1)
  const streamed = !!reply && last?.role === "assistant" && last.live
  const settled = settle(ls)
  if (streamed) settled[settled.length - 1] = { role: "assistant", text: reply }
  const tail: Line[] = []
  if (reply && !streamed) tail.push({ role: "assistant", text: reply })
  if (pending) tail.push({ role: "pending", pending })
  if (!reply && !pending) tail.push({ role: "assistant", text: "Done." })
  return [...settled, ...tail]
}
