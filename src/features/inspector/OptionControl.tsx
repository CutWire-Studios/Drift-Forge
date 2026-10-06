import { isParamRef, type ForgeNode, type GradientStop } from "@/core/doc/types"
import type { CurvePoint, OptionDef } from "@/core/nodes/types"
import { optionExposable, useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"
import { CurveEditor } from "@/shared/ui/CurveEditor"
import { GradientEditor, LabelsEditor, RegionPad } from "@/shared/ui/controls"
import { ScrubNumber, Toggle } from "@/shared/ui/widgets"
import { AssetPicker } from "./AssetPicker"
import { CustomCode } from "./CustomCode"

/** Expose / exposed-chip row for curve, gradient, picture and region options. */
function OptionExpose({ node, option }: { node: ForgeNode; option: OptionDef }) {
  const params = useDoc((d) => d.params)
  const { exposeOption, unexposeOption } = useEditor.getState()
  const v = node.data[option.id]
  if (isParamRef(v) && !Array.isArray(v.param)) {
    const p = params.find((q) => q.identifier === v.param)
    return (
      <span className="param-chip" title="Set the default in the Sliders tab.">
        <span className="param-dot" aria-hidden="true" />
        <span className="param-chip-label">{p?.displayName ?? v.param}</span>
        <button type="button" aria-label="Stop exposing" onClick={() => unexposeOption(node.id, option.id)}>
          ×
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      className="expose-btn"
      title="Let people change this in Drift"
      onClick={() => {
        const err = exposeOption(node.id, option.id)
        if (err) toast(err, "error")
      }}
    >
      <span className="param-dot" aria-hidden="true" /> Control in Drift
    </button>
  )
}

export function OptionControl({ node, option }: { node: ForgeNode; option: OptionDef }) {
  const setData = useEditor((s) => s.setData)
  const value = node.data[option.id] ?? ("default" in option ? option.default : undefined)
  const set = (v: unknown) => setData(node.id, option.id, v)

  const head = (
    <div className="nd-input-head">
      <span>{option.label}</span>
      {optionExposable(option) && <OptionExpose node={node} option={option} />}
    </div>
  )
  if (isParamRef(value)) {
    return (
      <div className="field">
        {head}
        <p className="meta small">Set in Drift. Edit its default in the Sliders tab.</p>
      </div>
    )
  }

  switch (option.kind) {
    case "select":
      return (
        <label className="field">
          <span>{option.label}</span>
          <select className="input input-sm" value={String(value)} onChange={(e) => set(e.target.value)}>
            {option.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )
    case "toggle":
      return (
        <div className="field-inline">
          <span>{option.label}</span>
          <Toggle value={!!value} onChange={set} label={option.label} />
        </div>
      )
    case "number":
      return (
        <label className="field">
          <span>{option.label}</span>
          <ScrubNumber value={Number(value)} min={option.min} max={option.max} step={option.step} onChange={set} />
        </label>
      )
    case "code":
      return <CustomCode value={String(value)} onChange={set} />
    case "labels":
      return (
        <div className="field">
          <span>{option.label}</span>
          <LabelsEditor value={value as string[]} onChange={set} />
        </div>
      )
    case "curve":
      return (
        <div className="field">
          {head}
          <CurveEditor points={value as CurvePoint[]} onChange={set} />
        </div>
      )
    case "gradient":
      return (
        <div className="field">
          {head}
          <GradientEditor value={value as GradientStop[]} onChange={set} />
        </div>
      )
    case "region":
      return (
        <div className="field">
          {head}
          <RegionPad value={value as [number, number, number, number]} onChange={set} ellipse={node.data.shape !== "rect"} />
        </div>
      )
    case "asset":
      return (
        <div className="field">
          {head}
          <AssetPicker value={value as string | undefined} onChange={set} />
        </div>
      )
  }
}
