import { KIND_INFO } from "@/core/doc/kinds"
import { isParamRef, type ForgeNode, type Kind, type Rgba, type Vec2 } from "@/core/doc/types"
import type { InputDef } from "@/core/nodes/types"
import { useDoc, useEditor } from "@/state/editor"
import { SeedInput } from "@/shared/ui/controls"
import { ColorSwatch, PointInput, PointPad, ScrubNumber, Toggle } from "@/shared/ui/widgets"

const CLOCK_LABEL = { time: "Follows clip time", progress: "Follows progress" }

function asVec2(v: unknown): Vec2 {
  return Array.isArray(v) ? [Number(v[0]), Number(v[1])] : [Number(v), Number(v)]
}

/** The control for one unconnected input: a literal widget, or the slider it's exposed as. */
export function InputControl({
  node,
  input,
  kind,
  large,
}: {
  node: ForgeNode
  input: InputDef
  kind: Kind
  large?: boolean
}) {
  const setInput = useEditor((s) => s.setInput)
  const unexpose = useEditor((s) => s.unexpose)
  const params = useDoc((d) => d.params)
  const value = node.inputs[input.id] ?? input.default

  if (input.clock) return <span className="input-note">{CLOCK_LABEL[KIND_INFO[kind].clock]}</span>

  if (isParamRef(value)) {
    const names = Array.isArray(value.param) ? value.param : [value.param]
    const label = names.map((n) => params.find((p) => p.identifier === n)?.displayName ?? n).join(" / ")
    return (
      <span className="param-chip nodrag" title="This is a slider in Drift. Click × to turn it back into a fixed value.">
        <span className="param-dot" aria-hidden="true" />
        <span className="param-chip-label">{label}</span>
        <button
          type="button"
          aria-label="Stop exposing"
          onClick={(e) => {
            e.stopPropagation()
            unexpose(node.id, input.id)
          }}
        >
          ×
        </button>
      </span>
    )
  }

  const set = (v: unknown) => setInput(node.id, input.id, v as never)

  if (input.widget === "seed") return <SeedInput compact={!large} value={Number(value)} onChange={set} />
  if (input.widget === "choice") {
    const labels = (node.data.labels as string[] | undefined) ?? []
    return (
      <select
        className="input input-sm choice-select nodrag"
        value={Math.round(Number(value))}
        onChange={(e) => set(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
      >
        {labels.map((l, i) => (
          <option key={i} value={i}>
            {l}
          </option>
        ))}
      </select>
    )
  }
  if (input.widget === "toggle") return <Toggle value={Number(value) > 0.5} onChange={(v) => set(v ? 1 : 0)} label={input.label} />
  if (input.type === "color") return <ColorSwatch value={value as Rgba} onChange={(rgba) => set(rgba)} label={input.label} />
  if (input.type === "vec2") {
    const v = asVec2(value)
    return (
      <div className="vec2-control">
        {large && input.widget === "point" && <PointPad value={v} onChange={set} />}
        <PointInput value={v} min={input.min} max={input.max} onChange={set} />
      </div>
    )
  }
  return (
    <ScrubNumber
      compact={!large}
      value={Number(value)}
      min={input.min}
      max={input.max}
      step={input.step}
      label={large ? undefined : input.label}
      onChange={set}
    />
  )
}
