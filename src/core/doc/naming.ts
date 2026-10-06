import { GLSL_RESERVED } from "@/core/glsl/literals"

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Why `name` can't be a Drift parameter identifier, or null if it can. */
export function paramNameProblem(name: string): string | null {
  if (!IDENT.test(name)) return "Use letters, digits and _ only, starting with a letter."
  if (name.startsWith("u_") || name.startsWith("gl_")) return 'Names starting with "u_" or "gl_" are reserved by Drift.'
  if (/^(n|s|k|x|pv)_/.test(name)) return "Names starting with n_, s_, k_, x_ or pv_ are used by generated code."
  if (/^buf\d+$|^tex\d+$/.test(name)) return "That name is used by generated code."
  if (GLSL_RESERVED.has(name)) return "That word is reserved in shader code."
  if (name.length > 48) return "Keep it under 48 characters."
  return null
}
