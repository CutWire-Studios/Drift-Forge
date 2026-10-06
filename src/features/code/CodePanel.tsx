import { useMemo, useState } from "react"
import { packageJson, packageJsonName } from "@/core/compiler/manifest"
import { useDoc } from "@/state/editor"
import { useCompiled } from "@/state/useCompiled"
import { Modal } from "@/shared/ui/Modal"
import { toast } from "@/shared/ui/toast"
import { CodeEditor } from "@/shared/ui/CodeEditor"
import "./code.css"

export function CodePanel({ onClose }: { onClose: () => void }) {
  const doc = useDoc()
  const r = useCompiled()
  const files = useMemo(() => {
    if (!r.ok) return null
    return [
      ...r.passes.map((p) => ({ name: p.file, text: p.source, lang: "glsl" as const })),
      { name: packageJsonName(doc), text: JSON.stringify(packageJson(doc, r), null, 2), lang: "json" as const },
    ]
  }, [doc, r])

  return (
    <Modal title="Shader code" onClose={onClose} wide>
      {files ? <CodeFiles files={files} /> : <p>Fix the problems shown on the canvas first; there's no code to show yet.</p>}
    </Modal>
  )
}

interface CodeFile {
  name: string
  text: string
  lang: "glsl" | "json"
}

function CodeFiles({ files }: { files: CodeFile[] }) {
  const [tab, setTab] = useState(0)
  const file = files[Math.min(tab, files.length - 1)]
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast("Copied")
  }
  return (
    <div className="code-panel">
      <p className="meta small">
        This is exactly what Drift runs. It's generated from your blocks, so edits belong in the graph; for hand-written code,
        add a <b>Custom GLSL</b> block.
      </p>
      <div className="tabs" role="tablist">
        {files.map((f, i) => (
          <button key={f.name} type="button" role="tab" className="tab" aria-selected={i === tab} onClick={() => setTab(i)}>
            {f.name}
          </button>
        ))}
      </div>
      <div className="code-view">
        <CodeEditor key={file.name} value={file.text} language={file.lang} readOnly />
      </div>
      <div className="row gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(file.text)}>
          Copy {file.name}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => copy(files.map((f) => `// ===== ${f.name} =====\n${f.text}`).join("\n\n"))}
        >
          Copy everything
        </button>
      </div>
    </div>
  )
}
