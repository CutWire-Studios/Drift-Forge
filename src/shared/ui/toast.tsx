import { create } from "zustand"
import "./toast.css"

interface Toast {
  id: number
  text: string
  kind: "info" | "error"
}

const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))
let next = 1

export function toast(text: string, kind: Toast["kind"] = "info") {
  const id = next++
  useToasts.setState((s) => ({ items: [...s.items, { id, text, kind }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3000)
}

export function Toasts() {
  const items = useToasts((s) => s.items)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
