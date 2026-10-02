import { useEffect, useMemo, useRef, useState } from "react"
import { paramNameProblem } from "@/compiler/validate"
import {
  EFFECT_CATEGORIES,
  isParamRef,
  TRANSITION_CATEGORIES,
  type ForgeDoc,
  type ForgeNode,
  type GradientStop,
  type ParamDef,
  type ParamDefault,
  type Rgba,
} from "@/doc/types"
import { hexToRgba, rgbaToHex, uid } from "@/doc/util"
import { assetBlob, assetFromFile } from "@/export/images"
import { categoryColor, CATEGORIES, nodeDef } from "@/nodes/registry"
import type { CurvePoint, OptionDef } from "@/nodes/types"
import { optionExposable, useEditor } from "@/state/editor"
import { toast } from "../toast"
import { AiPanel } from "./AiPanel"
import { CodeEditor } from "./CodeEditor"
import { CurveEditor } from "./CurveEditor"
import { InputControl } from "./InputControl"
import { SOCKET_NAMES } from "./NodeView"
import { GradientEditor, LabelsEditor, RegionPad, SeedInput } from "./controls"
import { ColorSwatch, PointPad, ScrubNumber, Toggle } from "./widgets"

type Tab = "node" | "sliders" | "info" | "ai"

export function Inspector() {
  const [tab, setTab] = useState<Tab>("node")
  const selected = useEditor((s) => s.selected)
  const params = useEditor((s) => s.doc!.params.length)
  const lastSel = useRef(selected)
  useEffect(() => {
    if (selected.length && selected !== lastSel.current) setTab((t) => (t === "ai" ? t : "node"))
    lastSel.current = selected
  }, [selected])

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
        {tab === "node" && <NodeTab />}
        {tab === "sliders" && <SlidersTab />}
        {tab === "info" && <InfoTab />}
        {tab === "ai" && <AiPanel />}
      </div>
    </section>
  )
}

function NodeTab() {
  const selected = useEditor((s) => s.selected)
  const node = useEditor((s) => (s.selected.length === 1 ? s.doc!.nodes.find((n) => n.id === s.selected[0]) : undefined))
  const { removeNodes, duplicateNodes } = useEditor.getState()

  if (selected.length > 1) {
    return (
      <div className="stack gap-3">
        <p>{selected.length} blocks selected.</p>
        <div className="row gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => duplicateNodes(selected)}>
            Duplicate
          </button>
          <button type="button" className="btn btn-secondary btn-sm danger-text" onClick={() => removeNodes(selected)}>
            Delete
          </button>
        </div>
      </div>
    )
  }
  if (!node) {
    return (
      <div className="inspector-tips">
        <h4>How it works</h4>
        <ol>
          <li>Blocks on the left change the picture. Drag them onto the canvas, or double-click the canvas to search.</li>
          <li>Connect a block's output dot (right) to another block's input dot (left). The picture flows left to right into Output. To remove a wire, hover it and click ×, or drag its end off the dot.</li>
          <li>
            Click a block to fine-tune it here. Press <span className="param-dot inline" /> next to a setting to turn it into a
            slider people can change in Drift.
          </li>
          <li>Hit Export when you're happy.</li>
        </ol>
        <p className="meta small">
          Shortcuts: <kbd>Space</kbd> add block · <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Ctrl</kbd>+
          <kbd>Z</kbd> undo
        </p>
      </div>
    )
  }
  return <NodeDetails node={node} />
}

function NodeDetails({ node }: { node: ForgeNode }) {
  const def = nodeDef(node.type)!
  const doc = useEditor((s) => s.doc!)
  const { expose, disconnect, removeNodes, duplicateNodes } = useEditor.getState()
  const cat = CATEGORIES.find((c) => c.id === def.category)

  return (
    <div className="node-details">
      <div className="nd-head" style={{ "--cat": categoryColor(def.category) } as React.CSSProperties}>
        <span className="pill">{cat?.label}</span>
        <h3>{def.label}</h3>
        <p className="meta">{def.description}</p>
      </div>

      {def.options?.map((o) => <OptionControl key={o.id} node={node} option={o} />)}

      {def.inputs.length > 0 && <h4 className="section-title">Settings</h4>}
      {def.inputs.map((input) => {
        const edge = doc.edges.find((e) => e.to === node.id && e.toSocket === input.id)
        const value = node.inputs[input.id]
        const exposable = !edge && !input.clock && !input.noExpose && !isParamRef(value) && !(input.type === "color" && input.widget !== "swatch")
        return (
          <div className="nd-input" key={input.id}>
            <div className="nd-input-head">
              <span title={SOCKET_NAMES[input.type]}>{input.label}</span>
              {exposable && (
                <button
                  type="button"
                  className="expose-btn"
                  title="Make this a slider people can change in Drift"
                  onClick={() => {
                    const err = expose(node.id, input.id)
                    if (err) toast(err, "error")
                  }}
                >
                  <span className="param-dot" aria-hidden="true" /> Slider in Drift
                </button>
              )}
            </div>
            {edge ? (
              <div className="nd-connected">
                <span>Connected to {nodeDef(doc.nodes.find((n) => n.id === edge.from)?.type ?? "")?.label}</span>
                <button type="button" className="btn btn-tertiary btn-sm" onClick={() => disconnect([edge.id])}>
                  Disconnect
                </button>
              </div>
            ) : input.type === "color" && input.widget !== "swatch" && !isParamRef(value) ? (
              <div className="nd-connected">
                <span className="meta">Not connected. Connect an image here.</span>
              </div>
            ) : (
              <InputControl node={node} input={input} kind={doc.kind} large />
            )}
            {input.hint && <p className="meta small">{input.hint}</p>}
          </div>
        )
      })}

      {!def.output && (
        <div className="row gap-2 nd-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => duplicateNodes([node.id])}>
            Duplicate
          </button>
          <button type="button" className="btn btn-secondary btn-sm danger-text" onClick={() => removeNodes([node.id])}>
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

/** Expose / exposed-chip row for curve, gradient, picture and region options. */
function OptionExpose({ node, option }: { node: ForgeNode; option: OptionDef }) {
  const params = useEditor((s) => s.doc!.params)
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

function OptionControl({ node, option }: { node: ForgeNode; option: OptionDef }) {
  const setData = useEditor((s) => s.setData)
  const value = node.data[option.id] ?? ("default" in option ? option.default : undefined)
  const set = (v: unknown) => setData(node.id, option.id, v)
  const exposed = isParamRef(value)

  const head = (
    <div className="nd-input-head">
      <span>{option.label}</span>
      {optionExposable(option) && <OptionExpose node={node} option={option} />}
    </div>
  )
  if (exposed) {
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

/** Debounced so half-typed code doesn't recompile on every keystroke. */
function CustomCode({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <div className="field">
      <span>Code</span>
      <div className="custom-code">
        <CodeEditor
          value={value}
          onChange={(v) => {
            clearTimeout(timer.current)
            timer.current = setTimeout(() => onChange(v), 400)
          }}
        />
      </div>
    </div>
  )
}

function AssetPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const assets = useEditor((s) => s.doc!.assets)
  const addAsset = useEditor((s) => s.addAsset)
  const urls = useMemo(() => new Map(assets.map((a) => [a.id, URL.createObjectURL(assetBlob(a))])), [assets])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <div className="asset-grid">
        {assets.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`asset-tile${a.id === value ? " active" : ""}`}
            onClick={() => onChange(a.id)}
            title={a.name}
          >
            <img src={urls.get(a.id)} alt={a.name} />
          </button>
        ))}
        <button type="button" className="asset-tile asset-add" onClick={() => input.current?.click()}>
          + Upload
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (!f) return
          try {
            const a = await assetFromFile(f, uid("a"))
            addAsset(a)
            onChange(a.id)
          } catch {
            toast("Couldn't read that picture.", "error")
          }
        }}
      />
      <p className="meta small">Pictures are saved inside the effect and exported with it.</p>
    </>
  )
}

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

function SlidersTab() {
  const doc = useEditor((s) => s.doc!)
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

function Presets() {
  const presets = useEditor((s) => s.doc!.presets ?? [])
  const { savePreset, applyPreset, deletePreset } = useEditor.getState()
  const [name, setName] = useState("")
  return (
    <div className="presets">
      <h4 className="section-title">Presets</h4>
      <p className="meta small">Named sets of values people can pick in Drift. Set the sliders above, then save.</p>
      {presets.map((p) => (
        <div className="row gap-2 preset-row" key={p.name}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => applyPreset(p.name)}>
            {p.name}
          </button>
          <button type="button" className="mini-btn" aria-label={`Delete preset ${p.name}`} onClick={() => deletePreset(p.name)}>
            ×
          </button>
        </div>
      ))}
      <form
        className="row gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          savePreset(name.trim())
          setName("")
        }}
      >
        <input className="input input-sm preset-name" placeholder="e.g. Subtle" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!name.trim()}>
          Save preset
        </button>
      </form>
    </div>
  )
}

function ParamValueControl({ p, value, onChange }: { p: ParamDef; value: ParamDefault; onChange: (v: ParamDefault) => void }) {
  switch (p.type) {
    case "bool":
      return <Toggle value={!!value} onChange={onChange} label={p.displayName} />
    case "color":
      return p.alpha ? (
        <div className="row gap-2">
          <ColorSwatch value={String(value).slice(0, 7)} onChange={(c) => onChange(rgbaToHex([c[0], c[1], c[2], hexToRgba(String(value))[3]]))} />
          <ScrubNumber
            compact
            label="Opacity"
            value={hexToRgba(String(value))[3]}
            onChange={(a) => {
              const c = hexToRgba(String(value))
              onChange(rgbaToHex([c[0], c[1], c[2], a] as Rgba))
            }}
          />
        </div>
      ) : (
        <ColorSwatch value={String(value)} onChange={(_, hex) => onChange(hex)} label={p.displayName} />
      )
    case "point": {
      const v = value as [number, number]
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
    case "choice":
      return (
        <select className="input input-sm" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {(p.options ?? []).map((o, i) => (
            <option key={i} value={i}>
              {o}
            </option>
          ))}
        </select>
      )
    case "seed":
      return <SeedInput value={Number(value)} onChange={onChange} />
    case "int":
      return <ScrubNumber value={Number(value)} min={p.min} max={p.max} step={1} onChange={onChange} label={p.displayName} />
    case "region":
      return <RegionPad value={value as [number, number, number, number]} onChange={onChange} ellipse={p.shape !== "rect"} />
    case "gradient":
      return <GradientEditor value={value as GradientStop[]} onChange={onChange} />
    case "curve":
      return <CurveEditor points={value as CurvePoint[]} onChange={onChange} />
    case "image":
      return <AssetPicker value={String(value)} onChange={onChange} />
    case "clip":
      return <p className="meta small">People pick a clip from their timeline in Drift. Here it shows the “Other clip” picked under the preview.</p>
    default:
      return (
        <ScrubNumber
          value={Number(value)}
          min={p.min}
          max={p.max}
          step={p.ui?.step}
          onChange={onChange}
          label={p.ui?.unit ? `${p.displayName} (${p.ui.unit})` : p.displayName}
        />
      )
  }
}

function ParamEditor({ p, index, count, onRenamed }: { p: ParamDef; index: number; count: number; onRenamed: (id: string) => void }) {
  const { updateParam, removeParam, moveParam } = useEditor.getState()
  const doc = useEditor((s) => s.doc!)
  const [ident, setIdent] = useState(p.identifier)
  const [err, setErr] = useState<string | null>(null)
  const switches = doc.params.filter((q) => q.type === "bool" && q.identifier !== p.identifier)

  return (
    <div className="param-editor">
      <p className="meta small">Type: {TYPE_LABEL[p.type]}</p>
      <label className="field">
        <span>Label in Drift</span>
        <input className="input input-sm" value={p.displayName} onChange={(e) => updateParam(p.identifier, { displayName: e.target.value })} />
      </label>
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
      {(p.type === "float" || p.type === "int" || p.type === "point") && (
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
      )}
      {p.type === "float" && (
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
      )}
      {p.type === "float" && (
        <div className="field-inline">
          <span>Show as a dial (angle)</span>
          <Toggle
            value={p.ui?.control === "angle"}
            onChange={(on) => updateParam(p.identifier, { ui: { ...p.ui, control: on ? "angle" : undefined } })}
          />
        </div>
      )}
      {p.type === "color" && (
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
      )}
      {p.type === "choice" && (
        <div className="field">
          <span>Choices</span>
          <LabelsEditor value={p.options ?? []} onChange={(options) => updateParam(p.identifier, { options, max: options.length - 1 })} />
        </div>
      )}
      {p.type === "region" && (
        <label className="field">
          <span>Drawn as</span>
          <select className="input input-sm" value={p.shape ?? "rect"} onChange={(e) => updateParam(p.identifier, { shape: e.target.value as "rect" | "ellipse" })}>
            <option value="rect">Box</option>
            <option value="ellipse">Oval</option>
          </select>
        </label>
      )}
      {p.type !== "clip" && (
        <div className="field">
          <span>Default</span>
          <ParamValueControl p={p} value={p.default} onChange={(v) => updateParam(p.identifier, { default: v })} />
        </div>
      )}
      {switches.length > 0 && (
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
      )}
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

function InfoTab() {
  const doc = useEditor((s) => s.doc!)
  const update = useEditor((s) => s.update)
  const set = (patch: Partial<ForgeDoc["meta"]>) => update((d) => void Object.assign(d.meta, patch))
  const cats = doc.kind === "effect" ? EFFECT_CATEGORIES : TRANSITION_CATEGORIES
  const idOk = /^[a-z0-9][a-z0-9_.]*$/.test(doc.meta.id)

  return (
    <div className="stack gap-3">
      <label className="field">
        <span>Name</span>
        <input className="input input-sm" value={doc.meta.displayName} onChange={(e) => set({ displayName: e.target.value })} />
      </label>
      <label className="field">
        <span>Category in Drift</span>
        <input className="input input-sm" list="forge-cats" value={doc.meta.category} onChange={(e) => set({ category: e.target.value })} />
        <datalist id="forge-cats">
          {cats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          className="input input-sm textarea"
          rows={3}
          value={doc.meta.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </label>
      <div className="row gap-2">
        <label className="field">
          <span>Author</span>
          <input className="input input-sm" value={doc.meta.author} onChange={(e) => set({ author: e.target.value })} />
        </label>
        <label className="field">
          <span>Version</span>
          <input className="input input-sm" value={doc.meta.version} onChange={(e) => set({ version: e.target.value })} />
        </label>
      </div>
      {doc.kind === "effect" && (
        <label className="field">
          <span>Thumbnail moment (seconds)</span>
          <ScrubNumber
            value={doc.preview.thumbTime}
            min={0}
            max={10}
            onChange={(v) => update((d) => void (d.preview.thumbTime = v))}
          />
        </label>
      )}
      <details className="advanced">
        <summary>Advanced</summary>
        <label className="field">
          <span>Package id</span>
          <input className="input input-sm mono" value={doc.meta.id} onChange={(e) => set({ id: e.target.value.trim() })} />
          {!idOk && <span className="field-error">Use lowercase letters, digits, _ and . only.</span>}
          <span className="meta small">
            Drift remembers effects in projects by this id. Keep it the same when you update an effect, or projects using
            the old one won't find it.
          </span>
        </label>
      </details>
    </div>
  )
}
