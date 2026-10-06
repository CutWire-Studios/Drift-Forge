import { useRef, useState } from "react"
import { Link, useParams } from "react-router"
import { ReactFlowProvider } from "@xyflow/react"
import type { ForgeDoc } from "@/core/doc/types"
import { useEditor } from "@/state/editor"
import { AudioEditor } from "@/features/audio-board"
import { CodePanel } from "@/features/code"
import { ExportDialog } from "@/features/export"
import { GraphCanvas, Palette } from "@/features/graph"
import { Inspector } from "@/features/inspector"
import { PreviewPanel } from "@/features/preview"
import { useAutosave } from "./hooks/useAutosave"
import { useDocumentLoader } from "./hooks/useDocumentLoader"
import { usePreviewSync } from "./hooks/usePreviewSync"
import { useShortcuts } from "./hooks/useShortcuts"
import { useWebgl2 } from "./hooks/useWebgl2"
import { TopBar } from "./TopBar"
import "./editor.css"

type Dialog = "export" | "code" | null

export function Editor() {
  const id = useParams().id!
  const doc = useEditor((s) => s.doc)
  const localId = useEditor((s) => s.localId)
  const [dialog, setDialog] = useState<Dialog>(null)
  const quickAdd = useRef<(() => void) | null>(null)
  const webgl = useWebgl2()
  // Audio effects have their own board and preview, so none of the WebGL machinery applies to them.
  const isAudio = doc?.kind === "audio"

  const missing = useDocumentLoader(id)
  usePreviewSync(webgl && !isAudio)
  const saved = useAutosave(doc, localId, id, !isAudio)
  useShortcuts({ enabled: !dialog, graph: !isAudio, quickAdd })

  if (!webgl && !isAudio) {
    return (
      <main className="page empty-page">
        <h2>Your browser can't run the preview</h2>
        <p className="meta">
          Drift Forge needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.
        </p>
        <Link className="btn btn-primary" to="/">
          Back
        </Link>
      </main>
    )
  }
  if (missing) {
    return (
      <main className="page empty-page">
        <h2>This effect isn't in this browser</h2>
        <p className="meta">Effects are saved in the browser you made them in. Use a share link or a .driftfx file to move them.</p>
        <Link className="btn btn-primary" to="/">
          Back to your creations
        </Link>
      </main>
    )
  }
  if (!doc || localId !== id) return <main className="page empty-page" />

  if (isAudio) {
    return (
      <div className="editor audio-board">
        <TopBar onExport={() => {}} onCode={() => {}} saved={saved} />
        <AudioEditor />
      </div>
    )
  }
  return <GraphEditor doc={doc} saved={saved} dialog={dialog} setDialog={setDialog} quickAdd={quickAdd} />
}

interface GraphEditorProps {
  doc: ForgeDoc
  saved: boolean
  dialog: Dialog
  setDialog: (d: Dialog) => void
  quickAdd: React.RefObject<(() => void) | null>
}

function GraphEditor({ doc, saved, dialog, setDialog, quickAdd }: GraphEditorProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <ReactFlowProvider>
      <div className={`editor${expanded ? " preview-expanded" : ""}`}>
        <TopBar onExport={() => setDialog("export")} onCode={() => setDialog("code")} saved={saved} />
        <Palette kind={doc.kind} />
        <GraphCanvas quickAddRef={quickAdd} />
        <div className="side">
          <PreviewPanel kind={doc.kind} expanded={expanded} onToggleExpand={() => setExpanded((x) => !x)} />
          <Inspector />
        </div>
      </div>
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} onShowCode={() => setDialog("code")} />}
      {dialog === "code" && <CodePanel onClose={() => setDialog(null)} />}
    </ReactFlowProvider>
  )
}
