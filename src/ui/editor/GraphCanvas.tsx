import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import type { SocketType } from "@/doc/types"
import { useResolvedTheme } from "@/lib/theme"
import { categoryColor, nodeDef } from "@/nodes/registry"
import { useEditor } from "@/state/editor"
import { NodeView, SOCKET_COLORS } from "./NodeView"
import { QuickAdd, type PendingWire } from "./QuickAdd"
import { WireEdge } from "./WireEdge"

const nodeTypes = { forge: NodeView }
const edgeTypes = { wire: WireEdge }

export const DRAG_MIME = "application/x-forge-node"

function socketType(nodeType: string | undefined, socket: string | null | undefined, dir: "in" | "out"): SocketType {
  const def = nodeType ? nodeDef(nodeType) : undefined
  const list = dir === "in" ? def?.inputs : def?.outputs
  return list?.find((s) => s.id === socket)?.type ?? "color"
}

export function GraphCanvas({ quickAddRef }: { quickAddRef: React.RefObject<(() => void) | null> }) {
  const doc = useEditor((s) => s.doc!)
  const selected = useEditor((s) => s.selected)
  const { select, moveNode, removeNodes, connect, disconnect, addNode } = useEditor.getState()
  const rf = useReactFlow()
  const theme = useResolvedTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const mouse = useRef({ x: 200, y: 200 })

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const [quick, setQuick] = useState<{ x: number; y: number; wire: PendingWire | null } | null>(null)

  useEffect(() => {
    const sel = new Set(selected)
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      return doc.nodes.map((n) => ({
        ...byId.get(n.id),
        id: n.id,
        type: "forge",
        position: { x: n.x, y: n.y },
        data: {},
        selected: sel.has(n.id),
        deletable: !nodeDef(n.type)?.output,
      }))
    })
  }, [doc.nodes, selected])

  useEffect(() => {
    setEdges((prev) => {
      const sel = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return doc.edges.map((e) => {
        const from = doc.nodes.find((n) => n.id === e.from)
        const color = SOCKET_COLORS[socketType(from?.type, e.fromSocket, "out")]
        return {
          id: e.id,
          source: e.from,
          sourceHandle: e.fromSocket,
          target: e.to,
          targetHandle: e.toSocket,
          selected: sel.has(e.id),
          type: "wire",
          style: { stroke: color },
        }
      })
    })
  }, [doc.edges, doc.nodes])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, nodesRef.current)
      setNodes(next)
      const removed: string[] = []
      for (const c of changes) {
        if (c.type === "position" && c.position) moveNode(c.id, c.position.x, c.position.y)
        else if (c.type === "remove") removed.push(c.id)
      }
      if (removed.length) removeNodes(removed)
      if (changes.some((c) => c.type === "select")) select(next.filter((n) => n.selected).map((n) => n.id))
    },
    [moveNode, removeNodes, select],
  )

  const [hoverEdge, setHoverEdge] = useState<string | null>(null)
  const shownEdges = useMemo(
    () => (hoverEdge ? edges.map((e) => (e.id === hoverEdge ? { ...e, data: { hover: true } } : e)) : edges),
    [edges, hoverEdge],
  )
  // Dragging a wire's end off its socket and letting go on empty canvas removes it.
  const reconnected = useRef(false)

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es))
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id)
      if (removed.length) disconnect(removed)
    },
    [disconnect],
  )

  const openQuick = useCallback((x: number, y: number, wire: PendingWire | null = null) => setQuick({ x, y, wire }), [])

  useEffect(() => {
    quickAddRef.current = () => openQuick(mouse.current.x, mouse.current.y)
  }, [openQuick, quickAddRef])

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return
      const p = "changedTouches" in event ? event.changedTouches[0] : event
      const fromType = (state.fromNode as Node).id ? doc.nodes.find((n) => n.id === state.fromNode!.id)?.type : undefined
      const from = state.fromHandle.type
      openQuick(p.clientX, p.clientY, {
        node: state.fromNode.id,
        handle: state.fromHandle.id ?? "",
        from,
        type: socketType(fromType, state.fromHandle.id, from === "source" ? "out" : "in"),
      })
    },
    [doc.nodes, openQuick],
  )

  const pick = (type: string) => {
    if (!quick) return
    const pos = rf.screenToFlowPosition({ x: quick.x, y: quick.y })
    const id = addNode(type, pos.x - 20, pos.y - 30)
    const def = nodeDef(type)!
    const w = quick.wire
    if (w) {
      if (w.from === "source") {
        const input = def.inputs.find((i) => i.type === w.type) ?? def.inputs[0]
        if (input) connect(w.node, w.handle, id, input.id)
      } else {
        const out = def.outputs.find((o) => o.type === w.type) ?? def.outputs[0]
        if (out) connect(id, out.id, w.node, w.handle)
      }
    }
    setQuick(null)
  }

  const minimapColor = useMemo(
    () => (n: Node) => categoryColor(nodeDef(doc.nodes.find((d) => d.id === n.id)?.type ?? "")?.category ?? "math"),
    [doc.nodes],
  )

  return (
    <div
      ref={wrapRef}
      className="graph"
      onMouseMove={(e) => (mouse.current = { x: e.clientX, y: e.clientY })}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("react-flow__pane")) openQuick(e.clientX, e.clientY)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = "copy"
        }
      }}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(DRAG_MIME)
        if (!type) return
        e.preventDefault()
        const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        addNode(type, pos.x - 100, pos.y - 20)
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={shownEdges}
        edgeTypes={edgeTypes}
        onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)}
        onEdgeMouseLeave={() => setHoverEdge(null)}
        onReconnectStart={() => (reconnected.current = false)}
        onReconnect={(old, c) => {
          reconnected.current = true
          if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
          if (connect(c.source, c.sourceHandle, c.target, c.targetHandle)) disconnect([old.id])
        }}
        onReconnectEnd={(_, edge) => {
          if (!reconnected.current) disconnect([edge.id])
        }}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(c) => {
          if (c.source && c.target && c.sourceHandle && c.targetHandle) {
            connect(c.source, c.sourceHandle, c.target, c.targetHandle)
          }
        }}
        onConnectEnd={onConnectEnd}
        isValidConnection={(c) => c.source !== c.target}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        minZoom={0.15}
        maxZoom={2}
        zoomOnDoubleClick={false}
        panActivationKeyCode={null}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode={["Shift", "Meta", "Control"]}
        defaultEdgeOptions={{ interactionWidth: 16 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--border-strong)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={minimapColor} maskColor="color-mix(in srgb, var(--bg-primary) 70%, transparent)" />
      </ReactFlow>
      {doc.nodes.length <= 3 && (
        <div className="graph-hint">
          Double-click the canvas (or press <kbd>Space</kbd>) to add a block. Drag from a dot to connect; drag a wire's end away (or click its ×) to disconnect.
        </div>
      )}
      {quick && (
        <QuickAdd x={quick.x} y={quick.y} kind={doc.kind} wire={quick.wire} onPick={pick} onClose={() => setQuick(null)} />
      )}
    </div>
  )
}
