import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react"
import type { ForgeDoc, SocketType } from "@/core/doc/types"
import { nodeDef } from "@/core/nodes/registry"
import { useEditor } from "@/state/editor"
import { SOCKET_COLORS } from "./NodeView"

export function socketType(nodeType: string | undefined, socket: string | null | undefined, dir: "in" | "out"): SocketType {
  const def = nodeType ? nodeDef(nodeType) : undefined
  const list = dir === "in" ? def?.inputs : def?.outputs
  return list?.find((s) => s.id === socket)?.type ?? "color"
}

/** React Flow's nodes and edges, mirrored from the document and the selection, with changes written back. */
export function useFlowElements(doc: ForgeDoc) {
  const selected = useEditor((s) => s.selected)
  const { select, moveNode, removeNodes, disconnect } = useEditor.getState()
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const nodesRef = useRef(nodes)
  useLayoutEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  // Mirrors the document during render (React's "adjust state when a prop changes"), keeping what
  // React Flow measured about each node.
  const [mirrored, setMirrored] = useState<{ nodes: ForgeDoc["nodes"]; edges: ForgeDoc["edges"]; selected: string[] } | null>(null)
  if (mirrored?.nodes !== doc.nodes || mirrored.selected !== selected) {
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
  }
  if (mirrored?.edges !== doc.edges || mirrored.nodes !== doc.nodes) {
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
  }
  if (mirrored?.nodes !== doc.nodes || mirrored.edges !== doc.edges || mirrored.selected !== selected) {
    setMirrored({ nodes: doc.nodes, edges: doc.edges, selected })
  }

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
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => applyEdgeChanges(changes, es))
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id)
      if (removed.length) disconnect(removed)
    },
    [disconnect],
  )

  return { nodes, shownEdges, onNodesChange, onEdgesChange, setHoverEdge }
}
