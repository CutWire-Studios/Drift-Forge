import { useRef, useState } from "react"
import { audioAssets, BUILTIN_IRS, MAX_IR_SECONDS } from "@/core/audio/irs"
import { errorMessage } from "@/core/errors"
import { irAssetFromFile } from "@/services/audio-preview/irLoader"
import type { Pedal } from "@/core/doc/types"
import { useDoc, useEditor } from "@/state/editor"
import { toast } from "@/shared/ui/toast"

const UPLOAD = "__upload__"

/** Which space the convolution reverb puts the sound in: a built-in one, or a recording of your own. */
export function IrPicker({ pedal }: { pedal: Pedal }) {
  const doc = useDoc()
  const { setIr, addAsset } = useEditor.getState()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const own = audioAssets(doc)

  const upload = async (f: File) => {
    setBusy(true)
    try {
      const asset = await irAssetFromFile(f)
      addAsset(asset)
      setIr(pedal.id, asset.id)
    } catch (err) {
      toast(`Couldn't use that recording: ${errorMessage(err)}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="ir-picker" onPointerDown={(e) => e.stopPropagation()}>
      <span>Space</span>
      <select
        className="input input-sm"
        value={pedal.ir ?? ""}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === UPLOAD) file.current?.click()
          else setIr(pedal.id, e.target.value)
        }}
      >
        {BUILTIN_IRS.map((b) => (
          <option key={b.id} value={`builtin:${b.id}`}>
            {b.label}
          </option>
        ))}
        {own.length > 0 && (
          <optgroup label="Your recordings">
            {own.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={UPLOAD}>{busy ? "Loading…" : "Upload your own…"}</option>
      </select>
      <input
        ref={file}
        type="file"
        accept="audio/*"
        hidden
        title={`An impulse response: a clap or balloon pop recorded in a space, up to ${MAX_IR_SECONDS} seconds`}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ""
        }}
      />
    </label>
  )
}
