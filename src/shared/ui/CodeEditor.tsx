import { useEffect, useRef } from "react"
import { basicSetup, EditorView } from "codemirror"
import { EditorState } from "@codemirror/state"
import { cpp } from "@codemirror/lang-cpp"
import { json } from "@codemirror/lang-json"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c084fc" },
  { tag: [tags.typeName, tags.className], color: "#38bdf8" },
  { tag: [tags.number, tags.bool], color: "#fb923c" },
  { tag: tags.string, color: "#4ade80" },
  { tag: tags.comment, color: "var(--text-tertiary)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: "#facc15" },
  { tag: tags.processingInstruction, color: "#f472b6" },
])

const theme = EditorView.theme({
  "&": { fontSize: "12.5px", background: "var(--bg-tertiary)", color: "var(--text-primary)", height: "100%" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", caretColor: "var(--accent)" },
  ".cm-gutters": { background: "var(--bg-secondary)", color: "var(--text-tertiary)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { background: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--accent-muted) !important" },
  ".cm-scroller": { overflow: "auto" },
})

export function CodeEditor({
  value,
  onChange,
  readOnly,
  language = "glsl",
}: {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  language?: "glsl" | "json"
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          language === "json" ? json() : cpp(),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => v.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, language])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
    }
  }, [value])

  return <div className="code-editor nodrag nowheel" ref={host} onKeyDown={(e) => e.stopPropagation()} />
}
