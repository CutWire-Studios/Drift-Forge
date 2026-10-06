import type { ParamDef, ParamDefault, ParamDefOf, ParamType, ParamValues } from "@/core/doc/types"
import { hexToRgba, rgbaToHex } from "@/core/doc/util"
import { CurveEditor } from "@/shared/ui/CurveEditor"
import { GradientEditor, RegionPad, SeedInput } from "@/shared/ui/controls"
import { ColorSwatch, PointPad, ScrubNumber, Toggle } from "@/shared/ui/widgets"
import { AssetPicker } from "./AssetPicker"

interface ControlProps<T extends ParamType> {
  p: ParamDefOf<T>
  value: ParamValues[T]
  onChange: (v: ParamValues[T]) => void
}

function ColorControl({ p, value, onChange }: ControlProps<"color">) {
  if (!p.alpha) return <ColorSwatch value={String(value)} onChange={(_, hex) => onChange(hex)} label={p.displayName} />
  const rgba = hexToRgba(String(value))
  return (
    <div className="row gap-2">
      <ColorSwatch value={String(value).slice(0, 7)} onChange={(c) => onChange(rgbaToHex([c[0], c[1], c[2], rgba[3]]))} />
      <ScrubNumber compact label="Opacity" value={rgba[3]} onChange={(a) => onChange(rgbaToHex([rgba[0], rgba[1], rgba[2], a]))} />
    </div>
  )
}

function PointControl({ p, value: v, onChange }: ControlProps<"point">) {
  return (
    <div className="vec2-control">
      {p.min === 0 && p.max === 1 && <PointPad value={v} onChange={onChange} />}
      <div className="point-input">
        <ScrubNumber compact label="X" value={v[0]} min={p.min} max={p.max} onChange={(x) => onChange([x, v[1]])} />
        <ScrubNumber compact label="Y" value={v[1]} min={p.min} max={p.max} onChange={(y) => onChange([v[0], y])} />
      </div>
    </div>
  )
}

const PARAM_CONTROLS: { [T in ParamType]: (props: ControlProps<T>) => React.ReactNode } = {
  float: ({ p, value, onChange }) => (
    <ScrubNumber
      value={Number(value)}
      min={p.min}
      max={p.max}
      step={p.ui?.step}
      onChange={onChange}
      label={p.ui?.unit ? `${p.displayName} (${p.ui.unit})` : p.displayName}
    />
  ),
  bool: ({ p, value, onChange }) => <Toggle value={!!value} onChange={onChange} label={p.displayName} />,
  color: ColorControl,
  point: PointControl,
  choice: ({ p, value, onChange }) => (
    <select className="input input-sm" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {(p.options ?? []).map((o, i) => (
        <option key={i} value={i}>
          {o}
        </option>
      ))}
    </select>
  ),
  seed: ({ value, onChange }) => <SeedInput value={Number(value)} onChange={onChange} />,
  int: ({ p, value, onChange }) => <ScrubNumber value={Number(value)} min={p.min} max={p.max} step={1} onChange={onChange} label={p.displayName} />,
  region: ({ p, value, onChange }) => <RegionPad value={value} onChange={onChange} ellipse={p.shape !== "rect"} />,
  gradient: ({ value, onChange }) => <GradientEditor value={value} onChange={onChange} />,
  curve: ({ value, onChange }) => <CurveEditor points={value} onChange={onChange} />,
  image: ({ value, onChange }) => <AssetPicker value={String(value)} onChange={onChange} />,
  clip: () => <p className="meta small">People pick a clip from their timeline in Drift. Here it shows the “Other clip” picked under the preview.</p>,
}

export function ParamValueControl({ p, value, onChange }: { p: ParamDef; value: ParamDefault; onChange: (v: ParamDefault) => void }) {
  // TypeScript can't correlate PARAM_CONTROLS[p.type] with p across the union, so the one cast lives here.
  const Control = PARAM_CONTROLS[p.type] as (props: ControlProps<ParamType>) => React.ReactNode
  return <Control p={p} value={value} onChange={onChange} />
}
