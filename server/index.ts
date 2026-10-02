// Drift Forge server: the static app, sign-in with CutWire accounts, the hosted AI and the MCP
// endpoint. Runs behind nginx and the Cloudflare tunnel; only Workers AI is called on Cloudflare.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Hono, type Context, type Next } from "hono"
import { serveStatic } from "hono/bun"
import { aiRoutes } from "./ai"
import { createAuth } from "./auth"
import { config } from "./config"
import { Ledger } from "./db"
import { mcpHandler } from "./mcp"
import { RateLimiter } from "./ratelimit"

const ledger = Ledger.open(config.dataDir)
const auth = createAuth(ledger)
const mcp = mcpHandler(ledger)
const mcpLimiter = new RateLimiter(120, 60_000)

/** Inline scripts in index.html (the pre-paint theme script) are allowed by hash, nothing else. */
function inlineScriptHashes(): string[] {
  try {
    const html = readFileSync(join(config.staticDir, "index.html"), "utf8")
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${new Bun.CryptoHasher("sha256").update(m[1]).digest("base64")}'`,
    )
  } catch {
    return []
  }
}

const csp = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptHashes().join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  // Bring-your-own-key AI is called from the browser: Anthropic, OpenAI or the user's own
  // OpenAI-compatible server (https anywhere, or http on this machine for Ollama / LM Studio).
  "connect-src 'self' https://api.anthropic.com https://api.openai.com https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

/** The real visitor address: nginx and the tunnel are the only way in. */
const clientIp = (c: Context) => c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "unknown"

/** State-changing requests must come from Forge itself (sign-in cookies are SameSite=Lax too). */
async function sameOrigin(c: Context, next: Next) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== config.publicUrl) return c.json({ error: "Forbidden." }, 403)
    if (c.req.method === "POST" && c.req.path !== "/auth/logout" && !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ error: "Expected JSON." }, 415)
    }
  }
  await next()
}

const app = new Hono()

app.use("*", async (c, next) => {
  await next()
  c.header("X-Content-Type-Options", "nosniff")
  c.header("Referrer-Policy", "strict-origin-when-cross-origin")
  if (c.res.headers.get("content-type")?.startsWith("text/html")) c.header("Content-Security-Policy", csp)
})

app.get("/healthz", (c) => c.text("ok"))

app.use("/auth/*", sameOrigin)
app.route("/auth", auth.routes)

app.use("/api/*", sameOrigin)
app.route("/api", aiRoutes(ledger, auth))

app.all("/mcp", async (c) => {
  if (!mcpLimiter.take(clientIp(c))) return c.json({ error: "Too many requests." }, 429)
  return mcp.fetch(c.req.raw)
})

app.use(
  "/assets/*",
  serveStatic({
    root: config.staticDir,
    onFound: (_p, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
  }),
)
app.use(
  "/samples/*",
  serveStatic({ root: config.staticDir, onFound: (_p, c) => c.header("Cache-Control", "public, max-age=604800") }),
)
app.use("*", serveStatic({ root: config.staticDir }))
// Client-side routes (/edit/…) all serve the app. Read once: the file only changes with a deploy.
const indexHtml = (() => {
  try {
    return readFileSync(join(config.staticDir, "index.html"), "utf8")
  } catch {
    return null
  }
})()
app.get("*", (c) => {
  if (!indexHtml) return c.notFound()
  c.header("Cache-Control", "no-cache")
  return c.html(indexHtml)
})

// PID 1 in the container: exit promptly on stop, closing the database cleanly.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    ledger.db.close()
    process.exit(0)
  })
}

export default { port: config.port, fetch: app.fetch }
console.log(`drift forge listening on :${config.port}`)
