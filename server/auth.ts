// "Sign in with CutWire account": Forge is a confidential OpenID Connect client of the shared
// accounts service (Rauthy). The browser only ever holds an opaque, HttpOnly session cookie; tokens
// stay on the server.
import { Hono, type Context } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { config } from "./config"
import type { Ledger, Session } from "./db"

const SESSION_COOKIE = "__Host-forge_session"
const STATE_COOKIE = "__Host-forge_signin"
const SESSION_TTL = 30 * 86_400_000
const RECHECK_MS = 3_600_000

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  end_session_endpoint?: string
  revocation_endpoint?: string
}

let discovery: Promise<Discovery> | null = null
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

async function provider(): Promise<Discovery> {
  discovery ??= fetch(`${config.accountsUrl}/auth/v1/.well-known/openid-configuration`)
    .then((r) => {
      if (!r.ok) throw new Error(`discovery answered ${r.status}`)
      return r.json() as Promise<Discovery>
    })
    .catch((e) => {
      discovery = null
      throw e
    })
  return discovery
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url")
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)))
async function sha256(s: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
}

/** Only same-site paths, so ?return= can't send someone off-site after sign-in. */
const safeReturn = (p: string | undefined) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/")

const redirectUri = () => `${config.publicUrl}/auth/callback`
const basicAuth = () => `Basic ${Buffer.from(`${encodeURIComponent(config.oidcClientId)}:${encodeURIComponent(config.oidcClientSecret)}`).toString("base64")}`

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const p = await provider()
  const res = await fetch(p.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth() },
    body: new URLSearchParams(body),
  })
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`)
  return (await res.json()) as TokenResponse
}

async function verifyIdToken(token: string, nonce?: string) {
  const p = await provider()
  jwks ??= createRemoteJWKSet(new URL(p.jwks_uri))
  const { payload } = await jwtVerify(token, jwks, { issuer: p.issuer, audience: config.oidcClientId })
  if (nonce !== undefined && payload.nonce !== nonce) throw new Error("nonce mismatch")
  const name = String(payload.name ?? payload.preferred_username ?? payload.email ?? "CutWire user")
  return { sub: String(payload.sub), name }
}

export interface Auth {
  routes: Hono
  /** The signed-in session for a request, re-checked against the accounts service hourly. */
  session(c: Context): Promise<(Session & { id: string }) | null>
}

export function createAuth(ledger: Ledger): Auth {
  const routes = new Hono()

  async function session(c: Context) {
    const raw = getCookie(c, SESSION_COOKIE)
    if (!raw) return null
    const id = await sha256(raw)
    const s = ledger.getSession(id)
    if (!s) return null
    if (Date.now() - s.checked > RECHECK_MS) {
      // A refresh-token grant fails once the user is disabled or deleted, or the session was
      // revoked in the accounts service; then this session ends too.
      try {
        const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: config.oidcClientId })
        const who = t.id_token ? await verifyIdToken(t.id_token) : { sub: s.sub, name: s.name }
        if (who.sub !== s.sub) throw new Error("subject changed")
        ledger.touchSession(id, t.refresh_token ?? s.refresh, who.name)
        return { ...s, name: who.name, id }
      } catch {
        ledger.deleteSession(id)
        deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true })
        return null
      }
    }
    return { ...s, id }
  }

  routes.get("/login", async (c) => {
    ledger.sweep()
    const p = await provider()
    const state = random()
    const nonce = random()
    const verifier = random(48)
    const challenge = await sha256(verifier)
    ledger.putPending(state, { verifier, nonce, returnTo: safeReturn(c.req.query("return")) }, 10 * 60_000)
    // Ties the callback to the browser that started it (login CSRF).
    setCookie(c, STATE_COOKIE, state, { path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 600 })
    const url = new URL(p.authorization_endpoint)
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.oidcClientId,
      redirect_uri: redirectUri(),
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString()
    return c.redirect(url.toString())
  })

  routes.get("/callback", async (c) => {
    const state = c.req.query("state") ?? ""
    const expected = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: "/", secure: true })
    const fail = (why: string) => c.redirect(`/?signin_error=${encodeURIComponent(why)}`)
    if (c.req.query("error")) return fail(c.req.query("error_description") ?? "Sign-in was cancelled.")
    if (!state || state !== expected) return fail("That sign-in link doesn't belong to this browser. Try again.")
    const pending = ledger.takePending(state)
    const code = c.req.query("code")
    if (!pending || !code) return fail("That sign-in link has expired. Try again.")
    try {
      const t = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: config.oidcClientId,
        code_verifier: pending.verifier,
      })
      if (!t.id_token || !t.refresh_token) throw new Error("incomplete token response")
      const who = await verifyIdToken(t.id_token, pending.nonce)
      const raw = random()
      ledger.createSession(await sha256(raw), {
        sub: who.sub,
        name: who.name,
        refresh: t.refresh_token,
        expires: Date.now() + SESSION_TTL,
        checked: Date.now(),
      })
      setCookie(c, SESSION_COOKIE, raw, { path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: SESSION_TTL / 1000 })
      return c.redirect(pending.returnTo)
    } catch (e) {
      console.error("sign-in failed", e)
      return fail("Sign-in failed. Try again.")
    }
  })

  routes.post("/logout", async (c) => {
    const raw = getCookie(c, SESSION_COOKIE)
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true })
    if (raw) {
      const refresh = ledger.deleteSession(await sha256(raw))
      const p = await provider().catch(() => null)
      if (refresh && p?.revocation_endpoint) {
        await fetch(p.revocation_endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: basicAuth() },
          body: new URLSearchParams({ token: refresh, token_type_hint: "refresh_token" }),
        }).catch(() => {})
      }
    }
    return c.body(null, 204)
  })

  return { routes, session }
}
