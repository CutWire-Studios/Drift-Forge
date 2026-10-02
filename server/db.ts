import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

export interface Session {
  sub: string
  name: string
  refresh: string
  expires: number
  checked: number
}

export interface Pending {
  verifier: string
  nonce: string
  returnTo: string
}

export interface QuotaState {
  userUsed: number
  globalUsed: number
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Sign-in sessions, the daily neuron budget and MCP scratch documents. One process owns the file
 * and SQLite calls are synchronous, so a budget check and its booking can't interleave with
 * another request's.
 */
export class Ledger {
  readonly db: Database

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending (state TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, sub TEXT NOT NULL, name TEXT NOT NULL,
        refresh TEXT NOT NULL, expires INTEGER NOT NULL, checked INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, sub TEXT NOT NULL, neurons REAL NOT NULL,
        PRIMARY KEY (day, sub));
      CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, json TEXT NOT NULL, unplaced TEXT NOT NULL,
        expires INTEGER NOT NULL);
    `)
  }

  static open(dataDir: string): Ledger {
    mkdirSync(dataDir, { recursive: true })
    return new Ledger(join(dataDir, "forge.db"))
  }

  sweep() {
    const now = Date.now()
    this.db.run("DELETE FROM pending WHERE expires < ?", [now])
    this.db.run("DELETE FROM sessions WHERE expires < ?", [now])
    this.db.run("DELETE FROM docs WHERE expires < ?", [now])
    this.db.run("DELETE FROM usage WHERE day < ?", [new Date(now - 3 * 86_400_000).toISOString().slice(0, 10)])
  }

  putPending(state: string, p: Pending, ttlMs: number) {
    this.db.run("INSERT OR REPLACE INTO pending VALUES (?, ?, ?)", [state, JSON.stringify(p), Date.now() + ttlMs])
  }

  /** Single use: a state completes at most one sign-in. */
  takePending(state: string): Pending | null {
    const row = this.db.query<{ data: string; expires: number }, [string]>("SELECT data, expires FROM pending WHERE state = ?").get(state)
    this.db.run("DELETE FROM pending WHERE state = ?", [state])
    if (!row || row.expires < Date.now()) return null
    return JSON.parse(row.data) as Pending
  }

  createSession(id: string, s: Session) {
    this.db.run("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)", [id, s.sub, s.name, s.refresh, s.expires, s.checked])
  }

  getSession(id: string): Session | null {
    const row = this.db.query<Session, [string]>("SELECT sub, name, refresh, expires, checked FROM sessions WHERE id = ?").get(id)
    if (!row || row.expires < Date.now()) return null
    return row
  }

  touchSession(id: string, refresh: string, name: string) {
    this.db.run("UPDATE sessions SET refresh = ?, name = ?, checked = ? WHERE id = ?", [refresh, name, Date.now(), id])
  }

  /** Returns the refresh token so the caller can revoke it at the accounts service. */
  deleteSession(id: string): string | null {
    const row = this.db.query<{ refresh: string }, [string]>("SELECT refresh FROM sessions WHERE id = ?").get(id)
    this.db.run("DELETE FROM sessions WHERE id = ?", [id])
    return row?.refresh ?? null
  }

  private used(sub: string): number {
    return this.db.query<{ neurons: number }, [string, string]>("SELECT neurons FROM usage WHERE day = ? AND sub = ?").get(today(), sub)?.neurons ?? 0
  }

  quota(sub: string): QuotaState {
    return { userUsed: this.used(sub), globalUsed: this.used("*") }
  }

  /**
   * Books `neurons` against both budgets before a model call, or books nothing and refuses when
   * either budget would be exceeded.
   */
  reserve(sub: string, neurons: number, userLimit: number, globalLimit: number): { ok: boolean } & QuotaState {
    const q = this.quota(sub)
    if (q.userUsed + neurons > userLimit || q.globalUsed + neurons > globalLimit) return { ok: false, ...q }
    this.add(sub, neurons)
    this.add("*", neurons)
    return { ok: true, userUsed: q.userUsed + neurons, globalUsed: q.globalUsed + neurons }
  }

  /** Corrects a reservation once real usage is known (delta may be negative). */
  settle(sub: string, delta: number): QuotaState {
    this.add(sub, delta)
    this.add("*", delta)
    return this.quota(sub)
  }

  private add(sub: string, delta: number) {
    this.db.run(
      `INSERT INTO usage VALUES (?, ?, MAX(?, 0))
       ON CONFLICT(day, sub) DO UPDATE SET neurons = MAX(neurons + ?, 0)`,
      [today(), sub, delta, delta],
    )
  }

  putDoc(id: string, json: string, unplaced: string[], ttlMs: number) {
    this.db.run("INSERT OR REPLACE INTO docs VALUES (?, ?, ?, ?)", [id, json, JSON.stringify(unplaced), Date.now() + ttlMs])
  }

  getDoc(id: string): { json: string; unplaced: string[] } | null {
    const row = this.db.query<{ json: string; unplaced: string; expires: number }, [string]>("SELECT json, unplaced, expires FROM docs WHERE id = ?").get(id)
    if (!row || row.expires < Date.now()) return null
    return { json: row.json, unplaced: JSON.parse(row.unplaced) as string[] }
  }
}
