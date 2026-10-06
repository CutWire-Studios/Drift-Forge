import { useRef, useState } from "react"
import { AUDIO_SAMPLES, type AudioItem } from "@/services/preview/audio"
import { getEngine } from "@/services/preview/engine"
import { useUploads } from "./uploads"

export function MusicPicker() {
  const engine = getEngine()
  const [current, setCurrent] = useState(engine.audio.item?.id ?? AUDIO_SAMPLES[0].id)
  const [audible, setAudible] = useState(engine.audio.audible)
  const upload = useUploads((s) => s.audio)
  const setUpload = useUploads((s) => s.setAudio)
  const file = useRef<HTMLInputElement>(null)
  const all = upload ? [...AUDIO_SAMPLES, upload] : AUDIO_SAMPLES
  const choose = async (item: AudioItem) => {
    setCurrent(item.id)
    await engine.audio.load(item)
    await engine.audio.play()
  }
  return (
    <>
      <label className="source-picker">
        <span>Music</span>
        <select
          className="input input-sm"
          value={current}
          onChange={(e) => {
            if (e.target.value === "__upload") file.current?.click()
            else void choose(all.find((a) => a.id === e.target.value)!)
          }}
        >
          {all.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
          <option value="__upload">Use my own song…</option>
        </select>
        <input
          ref={file}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (f) void choose(setUpload(f))
          }}
        />
      </label>
      <label className="source-picker narrow">
        <span>Sound</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            engine.audio.setAudible(!audible)
            setAudible(!audible)
            void engine.audio.play()
          }}
        >
          {audible ? "On" : "Off"}
        </button>
      </label>
    </>
  )
}
