import type { AgentEvent, ChatTurn, Pending } from "@/core/ai/agent"
import type { ForgeDoc } from "@/core/doc/types"
import { useAccount, type Quota } from "./account"

export class HostedError extends Error {
  constructor(
    message: string,
    readonly quota?: Quota,
  ) {
    super(message)
  }
}

export type HostedEvent =
  | AgentEvent
  | { type: "progress"; doc: ForgeDoc }
  | { type: "done"; doc: ForgeDoc; reply: string; quota: Quota; stopped?: string }
  | { type: "error"; error: string; quota?: Quota }

/**
 * The hosted AI, streamed: reasoning, tool progress and intermediate graphs arrive as they happen.
 * Pictures stay in the browser: the server only needs to know an asset exists, so their bytes are
 * blanked out on the way up and put back into every graph that comes down.
 */
export async function hostedPrompt(
  doc: ForgeDoc,
  prompt: string,
  history: ChatTurn[],
  on: { event: (e: AgentEvent) => void; doc: (d: ForgeDoc) => void },
): Promise<{ reply: string; pending?: Pending; stopped?: string }> {
  const byId = new Map(doc.assets.map((a) => [a.id, a]))
  const restore = (d: ForgeDoc): ForgeDoc => ({ ...d, assets: d.assets.map((a) => byId.get(a.id) ?? a), preview: doc.preview })
  const slim = { ...doc, assets: doc.assets.map((a) => ({ ...a, data: "" })), preview: { thumbTime: doc.preview.thumbTime } }

  const r = await fetch("/api/ai", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc: slim, prompt, history }),
  })
  if (!r.ok || !r.body) {
    const body = (await r.json().catch(() => ({}))) as { error?: string; quota?: Quota }
    if (body.quota) useAccount.setState({ quota: body.quota })
    if (r.status === 401) useAccount.setState({ signedIn: false })
    throw new HostedError(body.error ?? "The AI couldn't finish that.", body.quota)
  }

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ""
  let pending: Pending | undefined
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const e = JSON.parse(line) as HostedEvent
      if (e.type === "progress") on.doc(restore(e.doc))
      else if (e.type === "done") {
        on.doc(restore(e.doc))
        useAccount.setState({ quota: e.quota })
        return { reply: e.reply, pending, stopped: e.stopped }
      } else if (e.type === "error") {
        if (e.quota) useAccount.setState({ quota: e.quota })
        throw new HostedError(e.error, e.quota)
      } else {
        if (e.type === "pending") pending = e.pending
        on.event(e)
      }
    }
  }
  throw new HostedError("The connection to the AI was interrupted. What it built so far is kept.")
}
