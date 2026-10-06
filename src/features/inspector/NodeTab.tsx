import { isParamRef, type ForgeEdge, type ForgeNode } from "@/core/doc/types"
import { categoryColor, CATEGORIES, nodeDef } from "@/core/nodes/registry"
import type { InputDef } from "@/core/nodes/types"
import { useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"
import { InputControl, SOCKET_NAMES } from "@/features/graph"
import { SourcePicker } from "@/features/preview"
import { OptionControl } from "./OptionControl"

export function NodeTab() {
  const selected = useEditor((s) => s.selected)
  const node = useDoc((d) => (selected.length === 1 ? d.nodes.find((n) => n.id === selected[0]) : undefined))
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
  if (!node) return <Tips />
  return <NodeDetails node={node} />
}

function Tips() {
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

/** Which preview source a source node shows: the "to" clip is the second one. */
const PREVIEW_SOURCE: Partial<Record<string, 0 | 1>> = { to: 1, video: 0, from: 0 }

function NodeDetails({ node }: { node: ForgeNode }) {
  const def = nodeDef(node.type)!
  const doc = useDoc()
  const { removeNodes, duplicateNodes } = useEditor.getState()
  const cat = CATEGORIES.find((c) => c.id === def.category)
  const preview = PREVIEW_SOURCE[node.type]

  return (
    <div className="node-details">
      <div className="nd-head" style={{ "--cat": categoryColor(def.category) } as React.CSSProperties}>
        <span className="pill">{cat?.label}</span>
        <h3>{def.label}</h3>
        <p className="meta">{def.description}</p>
      </div>

      {preview !== undefined && (
        <>
          <h4 className="section-title">Preview</h4>
          <SourcePicker index={preview} label="Preview clip" />
          <p className="meta small">Only for the preview here. In Drift this is the clip the {doc.kind} is used on.</p>
        </>
      )}

      {def.options?.map((o) => <OptionControl key={o.id} node={node} option={o} />)}

      {def.inputs.length > 0 && <h4 className="section-title">Settings</h4>}
      {def.inputs.map((input) => (
        <NodeInput key={input.id} node={node} input={input} edge={doc.edges.find((e) => e.to === node.id && e.toSocket === input.id)} />
      ))}

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

function NodeInput({ node, input, edge }: { node: ForgeNode; input: InputDef; edge?: ForgeEdge }) {
  const expose = useEditor((s) => s.expose)
  const value = node.inputs[input.id]
  const imageInput = input.type === "color" && input.widget !== "swatch"
  const exposable = !edge && !input.clock && !input.noExpose && !isParamRef(value) && !imageInput
  return (
    <div className="nd-input">
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
      <NodeInputBody node={node} input={input} edge={edge} unwiredImage={imageInput && !isParamRef(value)} />
      {input.hint && <p className="meta small">{input.hint}</p>}
    </div>
  )
}

function NodeInputBody({ node, input, edge, unwiredImage }: { node: ForgeNode; input: InputDef; edge?: ForgeEdge; unwiredImage: boolean }) {
  const doc = useDoc()
  const disconnect = useEditor((s) => s.disconnect)
  if (edge) {
    return (
      <div className="nd-connected">
        <span>Connected to {nodeDef(doc.nodes.find((n) => n.id === edge.from)?.type ?? "")?.label}</span>
        <button type="button" className="btn btn-tertiary btn-sm" onClick={() => disconnect([edge.id])}>
          Disconnect
        </button>
      </div>
    )
  }
  if (unwiredImage) {
    return (
      <div className="nd-connected">
        <span className="meta">Not connected. Connect an image here.</span>
      </div>
    )
  }
  return <InputControl node={node} input={input} kind={doc.kind} large />
}
