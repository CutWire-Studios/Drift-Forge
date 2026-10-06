import { compile, type CompileResult } from "@/core/compiler/compile"
import type { ForgeDoc } from "@/core/doc/types"
import { useDoc } from "./editor"

const exported = new WeakMap<ForgeDoc, CompileResult>()

/** The open document compiled for export, shared by everything that shows or packages it. */
export function compiledForExport(doc: ForgeDoc): CompileResult {
  let r = exported.get(doc)
  if (!r) {
    r = compile(doc, { mode: "export" })
    exported.set(doc, r)
  }
  return r
}

export function useCompiled(): CompileResult {
  return compiledForExport(useDoc())
}
