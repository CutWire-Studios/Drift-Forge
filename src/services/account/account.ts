import { create } from "zustand"

export interface Quota {
  userLeft: number
  userLimit: number
  globalLeft: number
}

interface Account {
  loaded: boolean
  signedIn: boolean
  name: string
  quota: Quota | null
  refresh(): Promise<void>
}

export const useAccount = create<Account>((set) => ({
  loaded: false,
  signedIn: false,
  name: "",
  quota: null,
  refresh: async () => {
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" })
      const me = (await r.json()) as { signedIn: boolean; name?: string; quota?: Quota }
      set({ loaded: true, signedIn: me.signedIn, name: me.name ?? "", quota: me.quota ?? null })
    } catch {
      set({ loaded: true, signedIn: false, name: "", quota: null })
    }
  },
}))

export function signIn() {
  location.assign(`/auth/login?return=${encodeURIComponent(location.pathname)}`)
}

export async function signOut() {
  await fetch("/auth/logout", { method: "POST", credentials: "same-origin" })
  await useAccount.getState().refresh()
}
