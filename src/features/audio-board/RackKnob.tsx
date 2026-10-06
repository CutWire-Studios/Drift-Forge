import { useState } from "react"
import { continuous, type KnobSpec } from "@/core/audio/pedals"
import { getValue, modulatorKind, rackOf, valueSpec, type ValuePath } from "@/core/audio/rack"
import { isParamRef } from "@/core/doc/types"
import { useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"
import { Toggle } from "@/shared/ui/widgets"
import { MOD_MIME } from "./dnd"
import { Knob, type KnobMod } from "./Knob"
import { modColor } from "./mods"

const numeric = (v: unknown) => Number(v)

export interface RackValue {
  spec?: KnobSpec
  value: number
  /** the slider it's bound to, by name */
  bound?: string
  set: (v: number) => void
}

/** A control's current value, whether fixed or bound to a slider, and how to change it. */
export function useRackValue(path: ValuePath): RackValue {
  const doc = useDoc()
  const paramValues = useEditor((s) => s.paramValues)
  const spec = valueSpec(rackOf(doc), path)
  const raw = getValue(rackOf(doc), path)
  if (isParamRef(raw)) {
    const p = doc.params.find((q) => q.identifier === raw.param)
    return {
      spec,
      bound: p?.displayName ?? raw.param,
      value: numeric(paramValues[raw.param] ?? p?.default ?? 0),
      // A bound control moves the slider's try-out value, exactly as the Sliders tab does.
      set: (v) => useEditor.getState().setParamValue(raw.param, p?.type === "bool" ? v >= 0.5 : v),
    }
  }
  return { spec, value: numeric(raw ?? spec?.default ?? 0), set: (v) => useEditor.getState().setRackValue(path, spec?.scale === "toggle" ? v >= 0.5 : v) }
}

/** The routes moving a pedal knob, as its rings: depth resolved through any slider it's bound to. */
function useKnobMods(path: ValuePath, spec?: KnobSpec): KnobMod[] {
  const doc = useDoc()
  const paramValues = useEditor((s) => s.paramValues)
  if (path.kind !== "knob" || !spec) return []
  const rack = rackOf(doc)
  return rack.routes
    .filter((r) => r.to === path.item && r.knob === spec.id)
    .map((r) => {
      const bound = isParamRef(r.depth) ? r.depth.param : undefined
      const depth = bound ? numeric(paramValues[bound] ?? doc.params.find((q) => q.identifier === bound)?.default ?? 0) : numeric(r.depth)
      const type = rack.modulators.find((m) => m.id === r.from)?.type ?? "lfo"
      return { mod: r.from, depth, color: modColor(rack, r.from), bipolar: modulatorKind(type).bipolar }
    })
}

const boundTitle = (bound?: string) => (bound ? `Slider in Drift: ${bound}` : undefined)

function RackSwitch({ spec, value, bound, set }: RackValue & { spec: KnobSpec }) {
  return (
    <label className="rack-switch" title={boundTitle(bound)}>
      <Toggle value={value >= 0.5} onChange={(on) => set(on ? 1 : 0)} label={spec.label} />
      <span>{spec.label}</span>
      {bound && <span className="param-dot" aria-hidden="true" />}
    </label>
  )
}

function RackChoice({ spec, value, bound, set }: RackValue & { spec: KnobSpec }) {
  return (
    <label className="rack-choice" title={boundTitle(bound)}>
      <span>
        {spec.label}
        {bound && <span className="param-dot inline" aria-hidden="true" />}
      </span>
      <select className="input input-sm" value={Math.round(value)} onChange={(e) => set(Number(e.target.value))} onPointerDown={(e) => e.stopPropagation()}>
        {(spec.options ?? []).map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Drop a modulator's handle here to have it move this knob. */
function ModDrop({ item, knob, children }: { item: string; knob: string; children: React.ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`knob-drop${over ? " over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MOD_MIME)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const mod = e.dataTransfer.getData(MOD_MIME)
        if (!mod) return
        e.preventDefault()
        const err = useEditor.getState().addRoute(mod, item, knob)
        if (err) toast(err, "error")
      }}
    >
      {children}
    </div>
  )
}

/** A pedal's or modulator's control on the board: a switch, a dropdown or a knob. */
export function RackKnob({ path, color }: { path: ValuePath; color: string }) {
  const value = useRackValue(path)
  const mods = useKnobMods(path, value.spec)
  const { spec } = value
  if (!spec) return null
  if (spec.scale === "toggle") return <RackSwitch {...value} spec={spec} />
  if (spec.scale === "choice") return <RackChoice {...value} spec={spec} />
  const knob = <Knob spec={spec} value={value.value} color={color} bound={value.bound} onChange={value.set} mods={mods} />
  if (path.kind !== "knob" || !continuous(spec)) return knob
  return (
    <ModDrop item={path.item} knob={spec.id}>
      {knob}
    </ModDrop>
  )
}
