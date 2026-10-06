import type { ReactNode } from "react"
import type { ParamDef, ParamType } from "@/core/doc/types"
import { hexToRgba, rgbaToHex } from "@/core/doc/util"
import { useEditor } from "@/state/editor"
import { LabelsEditor } from "@/shared/ui/controls"
import { Toggle } from "@/shared/ui/widgets"

type FieldProps = { p: ParamDef; updateParam: (identifier: string, patch: Partial<ParamDef>) => void }

function RangeFields({ p, updateParam }: FieldProps) {
  return (
    <div className="row gap-2">
      <label className="field">
        <span>Lowest</span>
        <input className="input input-sm" type="number" value={p.min} onChange={(e) => updateParam(p.identifier, { min: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Highest</span>
        <input className="input input-sm" type="number" value={p.max} onChange={(e) => updateParam(p.identifier, { max: Number(e.target.value) })} />
      </label>
    </div>
  )
}

function FloatUiFields({ p, updateParam }: FieldProps) {
  return (
    <div className="row gap-2">
      <label className="field">
        <span>Unit shown</span>
        <input
          className="input input-sm"
          placeholder="px, °, %"
          value={p.ui?.unit ?? ""}
          onChange={(e) => updateParam(p.identifier, { ui: { ...p.ui, unit: e.target.value || undefined } })}
        />
      </label>
      <label className="field">
        <span>Step</span>
        <input
          className="input input-sm"
          type="number"
          min={0}
          value={p.ui?.step ?? ""}
          onChange={(e) => updateParam(p.identifier, { ui: { ...p.ui, step: e.target.value ? Number(e.target.value) : undefined } })}
        />
      </label>
    </div>
  )
}

function WholeNumbersField({ p, updateParam }: FieldProps) {
  return (
    <div className="field-inline">
      <span>Whole numbers only</span>
      <Toggle
        value={p.type === "int"}
        onChange={(on) =>
          updateParam(
            p.identifier,
            on
              ? { type: "int", min: Math.round(p.min), max: Math.round(p.max), default: Math.round(Number(p.default)) }
              : { type: "float" },
          )
        }
      />
    </div>
  )
}

function DialField({ p, updateParam }: FieldProps) {
  return (
    <div className="field-inline">
      <span>Show as a dial (angle)</span>
      <Toggle
        value={p.ui?.control === "angle"}
        onChange={(on) => updateParam(p.identifier, { ui: { ...p.ui, control: on ? "angle" : undefined } })}
      />
    </div>
  )
}

function AlphaField({ p, updateParam }: FieldProps) {
  return (
    <div className="field-inline">
      <span>Allow transparency</span>
      <Toggle
        value={!!p.alpha}
        onChange={(on) =>
          updateParam(p.identifier, {
            alpha: on || undefined,
            default: on ? rgbaToHex(hexToRgba(String(p.default))) : String(p.default).slice(0, 7),
          })
        }
      />
    </div>
  )
}

function ChoicesField({ p, updateParam }: FieldProps) {
  return (
    <div className="field">
      <span>Choices</span>
      <LabelsEditor value={p.options ?? []} onChange={(options) => updateParam(p.identifier, { options, max: options.length - 1 })} />
    </div>
  )
}

function ShapeField({ p, updateParam }: FieldProps) {
  return (
    <label className="field">
      <span>Drawn as</span>
      <select className="input input-sm" value={p.shape ?? "rect"} onChange={(e) => updateParam(p.identifier, { shape: e.target.value as "rect" | "ellipse" })}>
        <option value="rect">Box</option>
        <option value="ellipse">Oval</option>
      </select>
    </label>
  )
}

const FIELDS: { types: ParamType[]; Field: (props: FieldProps) => ReactNode }[] = [
  { types: ["float", "int", "point"], Field: RangeFields },
  { types: ["float"], Field: FloatUiFields },
  { types: ["float", "int"], Field: WholeNumbersField },
  { types: ["float"], Field: DialField },
  { types: ["color"], Field: AlphaField },
  { types: ["choice"], Field: ChoicesField },
  { types: ["region"], Field: ShapeField },
]

/** The settings only some parameter types have: range, unit, whole numbers, transparency, choices, shape. */
export function ParamTypeFields({ p }: { p: ParamDef }) {
  const updateParam = useEditor((s) => s.updateParam)
  return (
    <>
      {FIELDS.filter((f) => f.types.includes(p.type)).map(({ Field }, i) => (
        <Field key={i} p={p} updateParam={updateParam} />
      ))}
    </>
  )
}
