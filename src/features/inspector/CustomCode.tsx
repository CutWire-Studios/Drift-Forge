import { useRef } from "react"
import { CodeEditor } from "@/shared/ui/CodeEditor"

const RECOMPILE_DELAY_MS = 400

/** Debounced so half-typed code doesn't recompile on every keystroke. */
export function CustomCode({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  return (
    <div className="field">
      <span>Code</span>
      <div className="custom-code">
        <CodeEditor
          value={value}
          onChange={(v) => {
            clearTimeout(timer.current)
            timer.current = setTimeout(() => onChange(v), RECOMPILE_DELAY_MS)
          }}
        />
      </div>
    </div>
  )
}
