import { create } from "zustand"
import type { AudioItem } from "@/services/preview/audio"
import type { MediaItem } from "@/services/preview/media"

interface Uploads {
  media: MediaItem[]
  /** at most one song of the user's own: uploading another releases the previous file */
  audio: AudioItem | null
  addMedia(item: MediaItem): void
  setAudio(file: File): AudioItem
}

/** Files picked for the preview in this tab; never saved. */
export const useUploads = create<Uploads>((set, get) => ({
  media: [],
  audio: null,
  addMedia: (item) => set({ media: [...get().media, item] }),
  setAudio: (file) => {
    const prev = get().audio
    if (prev) URL.revokeObjectURL(prev.url)
    const audio = { id: `user-${Date.now()}`, label: file.name, url: URL.createObjectURL(file), user: true }
    set({ audio })
    return audio
  },
}))
