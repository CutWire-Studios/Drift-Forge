import { memo, useCallback } from "react"
import { Handle, Position, type NodeProps } from "@xyflow/react"
import type { ForgeNode, Kind, SocketType } from "@/core/doc/types"
import { categoryColor, nodeDef } from "@/core/nodes/registry"
import type { InputDef, NodeDef } from "@/core/nodes/types"
import { getEngine } from "@/services/preview/engine"
import { useDoc } from "@/state/editor"
import { useEngineStatus } from "@/features/preview"
import { InputControl } from "./InputControl"

export const SOCKET_COLORS: Record<SocketType, string> = {
  float: "#a1a1aa",
  vec2: "#a78bfa",
  color: "#ffc107",
}

export const SOCKET_NAMES: Record<SocketType, string> = {
  float: "number",
  vec2: "point",
  color: "image / colour",
}

/** Which output (if any) gets a live thumbnail on the node. */
export function thumbOutput(def: NodeDef): string | null {
  if (def.output) return null
  const c = def.outputs.find((o) => o.type === "color")
  if (c) return c.id
  if (["generate", "transition", "mix"].includes(def.category)) return def.outputs.find((o) => o.type === "float")?.id ?? null
  if (def.type === "uv") return "dist"
  return null
}

function Thumb({ nodeId, output }: { nodeId: string; output: string }) {
  const ref = useCallback(
    (c: HTMLCanvasElement | null) => {
      getEngine().registerThumb(nodeId, output, c)
    },
    [nodeId, output],
  )
  return <canvas className="node-thumb" ref={ref} />
}

/** Wired inputs and image inputs show just their label; plain numbers show only their control. */
function InputBody({ node, input, kind, wired }: { node: ForgeNode; input: InputDef; kind: Kind; wired: boolean }) {
  const label = <span className="fnode-label">{input.label}</span>
  if (wired || (input.type === "color" && input.widget !== "swatch")) return label
  const control = <InputControl node={node} input={input} kind={kind} />
  if (input.type === "float" && !input.clock && (!input.widget || input.widget === "seed")) return control
  return (
    <>
      {label}
      {control}
    </>
  )
}

export const NodeView = memo(function NodeView({ id, selected }: NodeProps) {
  const node = useDoc((d) => d.nodes.find((n) => n.id === id))
  const kind = useDoc((d) => d.kind)
  const connected = useDoc((d) => d.edges.filter((e) => e.to === id).map((e) => e.toSocket).join(","))
  const error = useEngineStatus((s) => s.nodeErrors[id])
  if (!node) return null
  const def = nodeDef(node.type)
  if (!def) return <div className="fnode fnode-error">Unknown node {node.type}</div>
  const wired = new Set(connected.split(","))
  const thumb = thumbOutput(def)

  return (
    <div
      className={`fnode${selected ? " selected" : ""}${error ? " has-error" : ""}${def.output ? " fnode-output" : ""}`}
      style={{ "--cat": categoryColor(def.category) } as React.CSSProperties}
      title={error}
    >
      <div className="fnode-head">
        <span className="fnode-dot" aria-hidden="true" />
        <span className="fnode-title">{def.label}</span>
      </div>
      {thumb && <Thumb nodeId={id} output={thumb} />}
      {error && <div className="fnode-err">{error}</div>}
      <div className="fnode-body">
        {def.outputs.map((o) => (
          <div className="fnode-row fnode-out" key={o.id}>
            <span className="fnode-label">{o.label}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={o.id}
              className="sock"
              style={{ "--sock": SOCKET_COLORS[o.type] } as React.CSSProperties}
              title={`${o.label} (${SOCKET_NAMES[o.type]})`}
            />
          </div>
        ))}
        {def.inputs.map((input) => (
          <div className="fnode-row fnode-in" key={input.id}>
            <Handle
              type="target"
              position={Position.Left}
              id={input.id}
              className="sock"
              style={{ "--sock": SOCKET_COLORS[input.type] } as React.CSSProperties}
              title={`${input.label} (${SOCKET_NAMES[input.type]})`}
            />
            <InputBody node={node} input={input} kind={kind} wired={wired.has(input.id)} />
          </div>
        ))}
      </div>
    </div>
  )
})
