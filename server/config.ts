// Process configuration from the environment. Secrets are required in production; `FORGE_DEV=1`
// fills placeholders so the server starts locally without them (the AI and sign-in then fail
// clearly when used).

function env(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v !== undefined && v !== "") return v
  if (fallback !== undefined) return fallback
  if (process.env.FORGE_DEV === "1") return `dev-missing-${name}`
  throw new Error(`missing required environment variable ${name}`)
}

const num = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && process.env[name] !== "" ? n : fallback
}

export const config = {
  dev: process.env.FORGE_DEV === "1",
  port: num("PORT", 8080),
  /** https://forge.cutwire.org: the only Origin allowed to call /api and /auth */
  publicUrl: env("PUBLIC_URL", "http://localhost:5173").replace(/\/+$/, ""),
  staticDir: env("STATIC_DIR", "dist"),
  dataDir: env("DATA_DIR", "data"),

  accountsUrl: env("ACCOUNTS_URL", "https://accounts.cutwire.org").replace(/\/+$/, ""),
  oidcClientId: env("OIDC_CLIENT_ID", "forge"),
  oidcClientSecret: env("OIDC_CLIENT_SECRET"),

  cfAccountId: env("CF_ACCOUNT_ID"),
  /** API token scoped to Workers AI only */
  cfAiToken: env("CF_AI_TOKEN"),
  /** AI Gateway id; empty calls Workers AI directly */
  cfAiGateway: env("CF_AI_GATEWAY", ""),
  aiModel: env("AI_MODEL", "@cf/google/gemma-4-26b-a4b-it"),

  /** Workers AI's free tier is 10,000 neurons per UTC day; stay below it. */
  dailyNeurons: num("DAILY_NEURONS", 9000),
  userDailyNeurons: num("USER_DAILY_NEURONS", 600),
  /** neurons per 1,000 tokens, from the model's published price ($0.011 per 1,000 neurons) */
  neuronsPerKInput: num("NEURONS_PER_K_INPUT", 9.091),
  neuronsPerKOutput: num("NEURONS_PER_K_OUTPUT", 27.273),
}
