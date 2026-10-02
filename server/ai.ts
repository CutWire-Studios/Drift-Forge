// Hosted AI: signed-in CutWire users build effects with the Workers AI model, inside a hard daily
// neuron budget that keeps the whole service on the free tier.
//
// Everything that could turn this into a general-purpose AI lives here on the server: the system
// prompt, the model, the tools and the limits. A client sends only its prompt, a short text history
// and the current graph; it can't add instructions, tools or tool results, and what comes back is
// a graph plus a reply capped to a couple of sentences.
import { Hono } from "hono"
import { runAgent, type ChatTurn, type ModelAdapter } from "@/ai/agent"
import { fromOpenAI, toOpenAIMessages, toOpenAITools } from "@/ai/providers/openaiFormat"
import type { ForgeDoc } from "@/doc/types"
import { parseForgeDoc } from "@/export/link"
import type { Auth } from "./auth"
import { config } from "./config"
import type { Ledger } from "./db"
import { RateLimiter } from "./ratelimit"

const MAX_BODY = 256 * 1024
const MAX_PROMPT = 1500
const MAX_HISTORY = 8
const MAX_STEPS = 6
const MAX_OUTPUT_TOKENS = 1024
const MAX_REPLY = 600
const MAX_NODES = 150

class OverBudget extends Error {}

function workersAi(): ModelAdapter {
  const base = config.cfAiGateway
    ? `https://gateway.ai.cloudflare.com/v1/${config.cfAccountId}/${config.cfAiGateway}/workers-ai`
    : `https://api.cloudflare.com/client/v4/accounts/${config.cfAccountId}/ai/run`
  return {
    async complete({ system, messages, tools }) {
      const res = await fetch(`${base}/${config.aiModel}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.cfAiToken}` },
        body: JSON.stringify({
          messages: toOpenAIMessages(system, messages),
          tools: toOpenAITools(tools),
          tool_choice: "auto",
          max_completion_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) throw new Error(`Workers AI answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
      const body = (await res.json()) as { result?: unknown }
      return fromOpenAI((body.result ?? body) as Parameters<typeof fromOpenAI>[0])
    },
  }
}

const neurons = (input: number, output: number) => (input / 1000) * config.neuronsPerKInput + (output / 1000) * config.neuronsPerKOutput

/** Upper-bound estimate before a call: ~3 characters per token for the prompt, full output allowance. */
const estimateInputTokens = (chars: number) => Math.ceil(chars / 3)

function quotaView(q: { userUsed: number; globalUsed: number }) {
  return {
    userLeft: Math.max(0, Math.floor(config.userDailyNeurons - q.userUsed)),
    userLimit: config.userDailyNeurons,
    globalLeft: Math.max(0, Math.floor(config.dailyNeurons - q.globalUsed)),
  }
}

export function aiRoutes(ledger: Ledger, auth: Auth) {
  const app = new Hono()
  const limiter = new RateLimiter(8, 60_000)
  const adapter = workersAi()

  app.get("/me", async (c) => {
    const s = await auth.session(c)
    if (!s) return c.json({ signedIn: false })
    return c.json({ signedIn: true, name: s.name, quota: quotaView(ledger.quota(s.sub)) })
  })

  app.post("/ai", async (c) => {
    const s = await auth.session(c)
    if (!s) return c.json({ error: "Sign in with your CutWire account to use the built-in AI." }, 401)
    if (!limiter.take(s.sub)) return c.json({ error: "Slow down a little: too many requests in the last minute." }, 429)

    const raw = await c.req.text()
    if (raw.length > MAX_BODY) return c.json({ error: "This effect is too large for the built-in AI." }, 413)
    let body: { prompt?: unknown; history?: unknown; doc?: unknown }
    try {
      body = JSON.parse(raw)
    } catch {
      return c.json({ error: "Bad request." }, 400)
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT) : ""
    if (!prompt) return c.json({ error: "Say what you'd like to make." }, 400)
    // Only plain text turns survive: no roles, tool calls or instructions beyond user/assistant text.
    const history: ChatTurn[] = (Array.isArray(body.history) ? body.history : [])
      .filter((t): t is { role: string; text: string } => !!t && typeof t === "object" && typeof t.text === "string")
      .filter((t) => t.role === "user" || t.role === "assistant")
      .slice(-MAX_HISTORY)
      .map((t) => ({ role: t.role as ChatTurn["role"], text: t.text.slice(0, MAX_PROMPT) }))
    let doc: ForgeDoc
    try {
      doc = parseForgeDoc(JSON.stringify(body.doc))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    if (doc.nodes.length > MAX_NODES) return c.json({ error: "This graph is too big for the built-in AI." }, 413)

    const before = ledger.quota(s.sub)
    if (before.userUsed >= config.userDailyNeurons || before.globalUsed >= config.dailyNeurons) {
      return c.json(
        { error: "The built-in AI has used today's free allowance. It resets at midnight UTC, or add your own AI key in settings.", quota: quotaView(before) },
        429,
      )
    }

    let reserved = 0
    try {
      const run = await runAgent({
        adapter,
        doc,
        prompt,
        history,
        maxSteps: MAX_STEPS,
        beforeCall: (_step, messages) => {
          // The system prompt and tool list come to roughly 12k characters on top of the messages.
          const chars = JSON.stringify(messages).length + 12_000
          reserved = neurons(estimateInputTokens(chars), MAX_OUTPUT_TOKENS)
          const r = ledger.reserve(s.sub, reserved, config.userDailyNeurons, config.dailyNeurons)
          if (!r.ok) throw new OverBudget()
        },
        afterCall: (usage) => {
          // Without reported usage the reservation (an over-estimate) stands.
          if (usage) ledger.settle(s.sub, neurons(usage.input, usage.output) - reserved)
          reserved = 0
        },
      })
      return c.json({ doc: run.doc, reply: run.reply.slice(0, MAX_REPLY), log: run.log, quota: quotaView(ledger.quota(s.sub)) })
    } catch (e) {
      if (e instanceof OverBudget) {
        return c.json(
          { error: "The built-in AI ran out of today's free allowance partway through. Your graph wasn't changed.", quota: quotaView(ledger.quota(s.sub)) },
          429,
        )
      }
      console.error("ai request failed", e)
      return c.json({ error: "The AI couldn't finish that. Try again in a moment." }, 502)
    }
  })

  return app
}
