import { useRef } from "react"
import { MAX_STEPS, modulatorSpec, pedalSpec } from "@/audio/pedals"
import { allItems } from "@/audio/rack"
import { isSplit, type AudioRack, type Modulator } from "@/doc/types"
import { useEditor } from "@/state/editor"
import { RackKnob } from "./Board"
import { MOD_MIME, modColor, modLabel } from "./mods"
import { useMeters } from "./useMeters"

/** The modulator's output right now, as a bar (or a centred bar for an LFO's ±). */
function LiveValue({ mod, color, twoWay }: { mod: string; color: string; twoWay: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  useMeters((m) => {
    const v = m?.mods.get(mod) ?? 0
    const el = bar.current
    if (!el) return
    const w = twoWay ? Math.abs(v) * 50 : v * 100
    el.style.width = `${w.toFixed(1)}%`
    el.style.left = twoWay ? `${(v < 0 ? 50 - w : 50).toFixed(1)}%` : "0"
  })
  return (
    <div className={`mod-live${twoWay ? " two-way" : ""}`} aria-hidden="true">
      <div ref={bar} style={{ background: color }} />
    </div>
  )
}

/** Draw the sequence: click or drag across the bars to set each step's height. */
function StepsEditor({ mod, color }: { mod: Modulator; color: string }) {
  const setSteps = useEditor((s) => s.setSteps)
  const steps = mod.steps ?? [1]
  const box = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const paintAt = (e: React.PointerEvent) => {
    const el = box.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * steps.length)
    if (i < 0 || i >= steps.length) return
    const v = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)) * 20) / 20
    if (steps[i] === v) return
    const next = [...steps]
    next[i] = v
    setSteps(mod.id, next)
  }
  return (
    <div className="steps-editor">
      <div
        ref={box}
        className="steps-bars"
        role="group"
        aria-label="Step values"
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          paintAt(e)
        }}
        onPointerMove={(e) => drawing.current && paintAt(e)}
        onPointerUp={() => (drawing.current = false)}
      >
        {steps.map((v, i) => (
          <span key={i} style={{ height: `${Math.max(4, v * 100)}%`, background: color }} />
        ))}
      </div>
      <div className="row gap-2">
        <button type="button" className="mini-btn" aria-label="Fewer steps" disabled={steps.length <= 1} onClick={() => setSteps(mod.id, steps.slice(0, -1))}>
          −
        </button>
        <span className="meta small">{steps.length} steps</span>
        <button type="button" className="mini-btn" aria-label="More steps" disabled={steps.length >= MAX_STEPS} onClick={() => setSteps(mod.id, [...steps, steps[steps.length - 1]])}>
          +
        </button>
      </div>
    </div>
  )
}

function ModulatorCard({ rack, mod, selected }: { rack: AudioRack; mod: Modulator; selected: boolean }) {
  const spec = modulatorSpec(mod.type)
  const color = modColor(rack, mod.id)
  const label = modLabel(rack, mod.id)
  const { select, removeModulator, setModulatorSource } = useEditor.getState()
  const routes = rack.routes.filter((r) => r.from === mod.id).length

  return (
    <article
      className={`mod-card${selected ? " selected" : ""}`}
      style={{ "--cat": color } as React.CSSProperties}
      onPointerDown={(e) => (e.stopPropagation(), select([mod.id]))}
      aria-label={label}
    >
      <header className="pedal-head">
        <span
          className="mod-handle"
          draggable
          title="Drag onto any knob on the board to move it with this"
          onDragStart={(e) => {
            e.dataTransfer.setData(MOD_MIME, mod.id)
            e.dataTransfer.effectAllowed = "link"
          }}
        >
          ⊕
        </span>
        <strong>{label}</strong>
        <button type="button" className="mini-btn" aria-label={`Remove ${label}`} onClick={() => removeModulator(mod.id)}>
          ×
        </button>
      </header>
      <div className="pedal-knobs">
        {spec?.knobs.map((k) => (
          <RackKnob key={k.id} path={{ kind: "modKnob", mod: mod.id, knob: k.id }} color={color} />
        ))}
      </div>
      {mod.type === "envelope" && (
        <label className="field mod-source">
          <span>Follows</span>
          <select className="input input-sm" value={mod.source ?? "input"} onChange={(e) => setModulatorSource(mod.id, e.target.value)}>
            <option value="input">The board's input</option>
            {allItems(rack)
              .filter((i) => !isSplit(i))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {pedalSpec(i.type)?.label ?? i.type} output
                </option>
              ))}
          </select>
        </label>
      )}
      {mod.type === "steps" && <StepsEditor mod={mod} color={color} />}
      <footer className="mod-foot">
        <LiveValue mod={mod.id} color={color} twoWay={mod.type === "lfo"} />
        <span className="meta small">{routes ? `Moves ${routes} knob${routes === 1 ? "" : "s"}` : "Drag ⊕ onto a knob"}</span>
      </footer>
    </article>
  )
}

export function ModulatorStrip({ rack }: { rack: AudioRack }) {
  const selected = useEditor((s) => s.selected[0])
  const addModulator = useEditor((s) => s.addModulator)
  return (
    <section className="mod-strip" aria-label="Modulators">
      <div className="mod-strip-head">
        <h3>Modulators</h3>
        <span className="meta small">Things that turn knobs for you, over and over.</span>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => addModulator("lfo")}>
          + LFO
        </button>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => addModulator("envelope")}>
          + Envelope follower
        </button>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => addModulator("steps")}>
          + Step sequencer
        </button>
      </div>
      {rack.modulators.length > 0 && (
        <div className="mod-cards">
          {rack.modulators.map((m) => (
            <ModulatorCard key={m.id} rack={rack} mod={m} selected={selected === m.id} />
          ))}
        </div>
      )}
    </section>
  )
}
