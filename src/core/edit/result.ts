import { produce, type Draft } from "immer"
import type { ForgeDoc } from "@/core/doc/types"

export type OpResult<T = object> = ({ doc: ForgeDoc } & T) | { error: string }

export function isOpError(r: OpResult<object>): r is { error: string } {
  return "error" in r
}

export const edit = (doc: ForgeDoc, recipe: (d: Draft<ForgeDoc>) => void): ForgeDoc => produce(doc, recipe)
