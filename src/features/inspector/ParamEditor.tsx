import { useState } from "react"
import { paramNameProblem } from "@/core/doc/naming"
import type { ParamDef } from "@/core/doc/types"
import { useDoc, useEditor } from "@/state/editor"
import { ParamTypeFields } from "./ParamTypeFields"
import { ParamValueControl } from "./ParamValueControl"

const TYPE_LABEL: Record<ParamDef["type"], string> = {
  float: "Slider",
  bool: "Switch",
  color: "Colour",
  int: "Whole number",
  point: "Point",
  choice: "Dropdown",
  seed: "Random seed",
  region: "Region",
  image: "Picture",
  clip: "Clip",
  gradient: "Gradient",
  curve: "Curve",
}

export function ParamEditor({ p, index, count, onRenamed }: { p: ParamDef; index: number; count: number; onRenamed: (id: string) => void }) {
  const { updateParam, removeParam, moveParam } = useEditor.getState()

  return (
    <div className="param-editor">
      <p className="meta small">Type: {TYPE_LABEL[p.type]}</p>
      <label className="field">
        <span>Label in Drift</span>
        <input className="input input-sm" value={p.displayName} onChange={(e) => updateParam(p.identifier, { displayName: e.target.value })} />
      </label>
      <IdentifierField p={p} onRenamed={onRenamed} />
      <ParamTypeFields p={p} />
      {p.type !== "clip" && (
        <div className="field">
          <span>Default</span>
          <ParamValueControl p={p} value={p.default} onChange={(v) => updateParam(p.identifier, { default: v })} />
        </div>
      )}
      <ShowWhenField p={p} />
      <label className="field">
        <span>Group (optional)</span>
        <input
          className="input input-sm"
          placeholder="e.g. Glow"
          value={p.group ?? ""}
          onChange={(e) => updateParam(p.identifier, { group: e.target.value || undefined })}
        />
      </label>
      <div className="row gap-2">
        <button type="button" className="btn btn-tertiary btn-sm" disabled={index === 0} onClick={() => moveParam(p.identifier, -1)}>
          Move up
        </button>
        <button type="button" className="btn btn-tertiary btn-sm" disabled={index === count - 1} onClick={() => moveParam(p.identifier, 1)}>
          Move down
        </button>
        {p.type !== "clip" && (
          <button type="button" className="btn btn-tertiary btn-sm danger-text" onClick={() => removeParam(p.identifier)}>
            Remove slider
          </button>
        )}
      </div>
    </div>
  )
}

function IdentifierField({ p, onRenamed }: { p: ParamDef; onRenamed: (id: string) => void }) {
  const updateParam = useEditor((s) => s.updateParam)
  const [ident, setIdent] = useState(p.identifier)
  const [err, setErr] = useState<string | null>(null)
  return (
    <label className="field">
      <span>Name in code</span>
      <input
        className="input input-sm mono"
        value={ident}
        onChange={(e) => {
          setIdent(e.target.value)
          setErr(paramNameProblem(e.target.value))
        }}
        onBlur={() => {
          if (ident === p.identifier) return
          const problem = updateParam(p.identifier, { identifier: ident })
          if (problem) {
            setErr(problem)
            setIdent(p.identifier)
          } else {
            setErr(null)
            onRenamed(ident)
          }
        }}
      />
      {err && <span className="field-error">{err}</span>}
    </label>
  )
}

function ShowWhenField({ p }: { p: ParamDef }) {
  const updateParam = useEditor((s) => s.updateParam)
  const switches = useDoc((d) => d.params).filter((q) => q.type === "bool" && q.identifier !== p.identifier)
  if (!switches.length) return null
  return (
    <label className="field">
      <span>Only show when</span>
      <select
        className="input input-sm"
        value={p.showWhen ? `${p.showWhen.param}:${p.showWhen.equals}` : ""}
        onChange={(e) => {
          const [param, eq] = e.target.value.split(":")
          updateParam(p.identifier, { showWhen: param ? { param, equals: eq === "true" } : undefined })
        }}
      >
        <option value="">Always</option>
        {switches.flatMap((q) => [
          <option key={`${q.identifier}:true`} value={`${q.identifier}:true`}>
            “{q.displayName}” is on
          </option>,
          <option key={`${q.identifier}:false`} value={`${q.identifier}:false`}>
            “{q.displayName}” is off
          </option>,
        ])}
      </select>
    </label>
  )
}

