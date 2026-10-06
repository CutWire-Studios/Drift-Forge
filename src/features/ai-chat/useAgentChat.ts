import { useEffect, useState } from "react"
import { runAgent, type AgentEvent, type ChatTurn, type Pending } from "@/core/ai/agent"
import type { ForgeDoc } from "@/core/doc/types"
import { hostedPrompt, loadSettings, saveSettings, type AiSettings } from "@/services/account/client"
import { currentDoc, useEditor } from "@/state/editor"
import { applyEvent, EVENT_BUSY, finish, historyOf, settle, useChats, type Line } from "./lines"
import { adapterFor } from "./providers"

const MAX_STEPS = 20

interface RunResult {
  reply: string
  pending?: Pending
}

async function runModel(
  settings: AiSettings,
  doc: ForgeDoc,
  prompt: string,
  history: ChatTurn[],
  onEvent: (e: AgentEvent) => void,
  apply: (d: ForgeDoc) => void,
): Promise<RunResult> {
  if (settings.provider === "cutwire") return hostedPrompt(doc, prompt, history, { event: onEvent, doc: apply })
  const adapter = adapterFor({ ...settings, provider: settings.provider })
  if (typeof adapter === "string") throw new Error(adapter)
  const run = await runAgent({ adapter, doc, prompt, history, maxSteps: MAX_STEPS, onEvent, onStep: apply })
  apply(run.doc)
  return run
}

/** One document's conversation with the AI: sending prompts, streaming the log and applying edits. */
export function useAgentChat(localId: string) {
  const [settings, setSettings] = useState(loadSettings)
  const [lines, setLines] = useState<Line[]>(() => useChats.getState().chats[localId] ?? [])
  const [busy, setBusy] = useState<string | null>(null)
  const [input, setInput] = useState("")

  useEffect(() => {
    useChats.setState((s) => ({ chats: { ...s.chats, [localId]: lines } }))
  }, [lines, localId])

  const updateSettings = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  const onEvent = (e: AgentEvent) => {
    setLines((ls) => applyEvent(ls, e))
    const next = EVENT_BUSY[e.type]
    if (next !== undefined) setBusy(next)
  }

  const send = async (raw: string) => {
    const prompt = raw.trim()
    if (!prompt || busy) return
    const history = historyOf(lines)
    setLines((ls) => [...ls, { role: "user", text: prompt }])
    setInput("")
    setBusy("Thinking…")
    try {
      let result: RunResult = { reply: "" }
      await useEditor.getState().withUndoGroup(async (apply) => {
        result = await runModel(settings, currentDoc(), prompt, history, onEvent, apply)
      })
      setLines((ls) => finish(ls, result.reply, result.pending))
    } catch (e) {
      setLines((ls) => [...settle(ls), { role: "error", text: e instanceof Error ? e.message : "Something went wrong." }])
    } finally {
      setBusy(null)
    }
  }

  return { settings, updateSettings, lines, busy, input, setInput, send }
}
