import { createStore, del, entries, get, set } from "idb-keyval"
import type { ForgeDoc } from "@/core/doc/types"
import { uid } from "@/core/doc/util"
import { parseForgeDoc } from "@/core/export/link"

export interface LibraryEntry {
  localId: string
  doc: ForgeDoc
  updatedAt: number
  /** small JPEG data URL of the last preview frame */
  thumb?: string
}

const store = createStore("drift-forge", "library")

export async function listLibrary(): Promise<LibraryEntry[]> {
  const all = (await entries<string, LibraryEntry>(store)).map(([, v]) => v)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadEntry(localId: string): Promise<LibraryEntry | undefined> {
  const e = await get<LibraryEntry>(localId, store)
  if (e) e.doc = parseForgeDoc(JSON.stringify(e.doc))
  return e
}

export async function saveEntry(entry: LibraryEntry): Promise<void> {
  await set(entry.localId, entry, store)
}

export async function createEntry(doc: ForgeDoc, thumb?: string): Promise<string> {
  const localId = uid("d")
  await saveEntry({ localId, doc, updatedAt: Date.now(), thumb })
  return localId
}

export async function deleteEntry(localId: string): Promise<void> {
  await del(localId, store)
}
