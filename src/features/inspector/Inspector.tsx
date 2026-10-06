import { useEffect, useRef, useState } from "react"
import { useDoc, useEditor } from "@/state/editor"
import { AiPanel } from "@/features/ai-chat"
import { InfoTab } from "./InfoTab"
import { NodeTab } from "./NodeTab"
import { SlidersTab } from "./SlidersTab"
import "./inspector.css"

type Tab = "node" | "sliders" | "info" | "ai"

const TABS: Record<Tab, () => React.ReactNode> = {
  node: NodeTab,
  sliders: SlidersTab,
  info: InfoTab,
  ai: AiPanel,
}

export function Inspector() {
  const [tab, setTab] = useState<Tab>("node")
  const selected = useEditor((s) => s.selected)
  const params = useDoc((d) => d.params.length)
  const lastSel = useRef(selected)
  useEffect(() => {
    if (selected.length && selected !== lastSel.current) setTab((t) => (t === "ai" ? t : "node"))
    lastSel.current = selected
  }, [selected])
  const Body = TABS[tab]

  return (
    <section className="inspector">
      <div className="tabs" role="tablist">
        {(
          [
            ["node", "Block"],
            ["sliders", `Sliders${params ? ` (${params})` : ""}`],
            ["info", "Details"],
            ["ai", "AI"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        <Body />
      </div>
    </section>
  )
}
