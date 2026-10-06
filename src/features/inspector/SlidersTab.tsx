import { useState } from "react"
import type { ParamDef } from "@/core/doc/types"
import { useDoc, useEditor } from "@/state/editor"
import { ParamEditor } from "./ParamEditor"
import { ParamValueControl } from "./ParamValueControl"
import { Presets } from "./Presets"

export function SlidersTab() {
  const doc = useDoc()
  const values = useEditor((s) => s.paramValues)
  const { setParamValue, resetParamValues } = useEditor.getState()
  const [editing, setEditing] = useState<string | null>(null)
  const params = doc.params

  if (!params.length) {
    return (
      <div className="inspector-tips">
        <h4>No sliders yet</h4>
        <p>
          Sliders are the settings people can change when they use your {doc.kind} in Drift. Select a block and press{" "}
          <span className="param-dot inline" /> <b>Slider in Drift</b> next to any setting to add one.
        </p>
      </div>
    )
  }

  const visible = (p: ParamDef) => {
    if (!p.showWhen) return true
    const sw = params.find((q) => q.identifier === p.showWhen!.param)
    return !sw || !!(values[sw.identifier] ?? sw.default) === p.showWhen.equals
  }

  return (
    <div className="sliders">
      <p className="meta small">This is how your controls appear in Drift. Move them to try values; that doesn't change the defaults.</p>
      {params.map((p, i) => (
        <div className={`slider-card${visible(p) ? "" : " hidden-when"}`} key={p.identifier}>
          <div className="slider-head">
            <span>
              {p.displayName}
            </span>
            <button
              type="button"
              className="btn btn-tertiary btn-sm"
              onClick={() => setEditing(editing === p.identifier ? null : p.identifier)}
            >
              {editing === p.identifier ? "Done" : "Edit"}
            </button>
          </div>
          {!visible(p) && <p className="meta small">Hidden in Drift until its switch is on.</p>}
          <ParamValueControl p={p} value={values[p.identifier] ?? p.default} onChange={(v) => setParamValue(p.identifier, v)} />
          {editing === p.identifier && <ParamEditor p={p} index={i} count={params.length} onRenamed={setEditing} />}
        </div>
      ))}
      <button type="button" className="btn btn-tertiary btn-sm" onClick={resetParamValues}>
        Reset to defaults
      </button>
      <Presets />
    </div>
  )
}
