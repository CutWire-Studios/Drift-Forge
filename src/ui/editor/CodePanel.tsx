import { useMemo, useState } from "react"
import { compile } from "@/compiler/compile"
import { packageJson, packageJsonName } from "@/compiler/manifest"
import { useEditor } from "@/state/editor"
import { Modal } from "../Modal"
import { toast } from "../toast"
import { CodeEditor } from "./CodeEditor"

export function CodePanel({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc!)
  const files = useMemo(() => {
    const r = compile(doc, { mode: "export" })
    if (!r.ok) return null
    return [
      ...r.passes.map((p) => ({ name: p.file, text: p.source, lang: "glsl" as const })),
      { name: packageJsonName(doc), text: JSON.stringify(packageJson(doc, r), null, 2), lang: "json" as const },
    ]
  }, [doc])
  const [tab, setTab] = useState(0)

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast("Copied")
  }

  return (
    <Modal title="Shader code" onClose={onClose} wide>
      {!files ? (
        <p>Fix the problems shown on the canvas first; there's no code to show yet.</p>
      ) : (
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
            <CodeEditor key={files[Math.min(tab, files.length - 1)].name} value={files[Math.min(tab, files.length - 1)].text} language={files[Math.min(tab, files.length - 1)].lang} readOnly />
          </div>
          <div className="row gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(files[Math.min(tab, files.length - 1)].text)}>
              Copy {files[Math.min(tab, files.length - 1)].name}
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
      )}
    </Modal>
  )
}
