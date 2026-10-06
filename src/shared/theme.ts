import { useSyncExternalStore } from "react"

export type Theme = "light" | "dark" | "system"

// Same key as the Marketplace, so a choice made on one CutWire site reads the same here.
const KEY = "cw-theme"
const listeners = new Set<() => void>()

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    if (value === "light" || value === "dark") return value
  } catch {
    // Private windows and blocked site data both throw here; the system
    // preference is a perfectly good answer.
  }
  return "system"
}

let theme: Theme = stored()

const media = window.matchMedia("(prefers-color-scheme: dark)")
media.addEventListener("change", () => listeners.forEach((l) => l()))

export function resolvedTheme(): "light" | "dark" {
  if (theme !== "system") return theme
  return media.matches ? "dark" : "light"
}

export function setTheme(next: Theme) {
  theme = next
  const root = document.documentElement
  if (next === "system") delete root.dataset.theme
  else root.dataset.theme = next
  try {
    if (next === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Nothing to do: the choice still applies for this page view.
  }
  listeners.forEach((l) => l())
}

export function cycleTheme() {
  setTheme(resolvedTheme() === "dark" ? "light" : "dark")
}

export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    resolvedTheme,
  )
}
