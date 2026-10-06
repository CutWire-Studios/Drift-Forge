import { beforeEach, describe, expect, it } from "vitest"
import { unzipSync } from "fflate"
import { compile } from "@/core/compiler/compile"
import { packageJson } from "@/core/compiler/manifest"
import type { ForgeDoc } from "@/core/doc/types"
import { exportZip } from "@/core/export/archive"
import { useEditor } from "@/state/editor"
import { chain } from "./helpers"

const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

function load(doc: ForgeDoc) {
  useEditor.getState().load("t", doc)
  return useEditor.getState()
}
const doc = () => useEditor.getState().doc!
const node = (type: string) => doc().nodes.find((n) => n.type === type)!

describe("package extras", () => {
  beforeEach(() => load(chain("effect", ["twirl", "kaleidoscope"])))

  it("writes hints, show-when and presets, which today's Drift ignores", () => {
    const s = useEditor.getState()
    s.expose(node("kaleidoscope").id, "rotation")
    s.addParam({ identifier: "glowOn", displayName: "Glow", type: "bool", min: 0, max: 1, default: true })
    s.updateParam("rotation", { showWhen: { param: "glowOn", equals: true } })
    s.setParamValue("rotation", 45)
    s.savePreset("Tilted")
    const json = packageJson(doc(), compile(doc(), { mode: "export" })) as Record<string, unknown>
    const params = json.parameters as Record<string, unknown>[]
    expect(params[0]).toMatchObject({ type: "float", ui: { control: "angle", unit: "°" }, showWhen: { param: "glowOn", equals: true } })
    expect(json.presets).toEqual([{ name: "Tilted", values: { rotation: 45, glowOn: 1 } }])
    expect(json.nextFeatures).toBeUndefined()
  })
})

describe("controls", () => {
  beforeEach(() => {
    const d = chain("effect", ["twirl", "kaleidoscope", "gradient_ramp"])
    load(d)
  })

  it("exposes native point, int and dropdown parameters", () => {
    const s = useEditor.getState()
    s.expose(node("twirl").id, "center")
    s.expose(node("kaleidoscope").id, "segments")
    const choice = s.addNode("choice", 0, 0)
    expect(useEditor.getState().expose(choice, "value")).toBeNull()
    expect(doc().params.map((p) => p.type)).toEqual(["point", "int", "choice"])
    const r = compile(doc(), { mode: "export" })
    expect(r.ok).toBe(true)
    const src = r.passes.at(-1)!.source
    expect(src).toContain("uniform vec2 centre;")
    expect(src).toContain("vec2 pv_centre() { return centre; }")
    const json = packageJson(doc(), r) as { parameters: Record<string, unknown>[]; nextFeatures: string[] }
    expect(json.parameters[0]).toMatchObject({ type: "point", minValue: [0, 0], maxValue: [1, 1], defaultValue: [0.5, 0.5] })
    expect(json.parameters[2]).toMatchObject({ type: "choice", options: ["First", "Second", "Third"], defaultValue: 0 })
    expect(json.nextFeatures).toEqual(["param:choice", "param:int", "param:point"])
  })

  it("binds an exposed gradient as a named sampler", () => {
    expect(useEditor.getState().exposeOption(node("gradient_ramp").id, "stops")).toBeNull()
    const r = compile(doc(), { mode: "export" })
    const last = r.passes.at(-1)!
    expect(last.source).toContain("uniform sampler2D gradient;")
    expect(last.paramSamplers).toEqual(["gradient"])
    const json = packageJson(doc(), r) as { parameters: Record<string, unknown>[] }
    expect(json.parameters[0]).toMatchObject({ type: "gradient", defaultValue: [{ position: 0, color: "#0d0526ff" }, { position: 0.5 }, { position: 1 }] })
  })

  it("writes a picture parameter's default image into the package", () => {
    const s = useEditor.getState()
    s.addAsset({ id: "a1", name: "logo.png", mime: "image/png", data: PIXEL, width: 1, height: 1 })
    const img = s.addNode("image", 0, 0)
    useEditor.getState().setData(img, "asset", "a1")
    expect(useEditor.getState().exposeOption(img, "asset")).toBeNull()
    const files = Object.keys(unzipSync(exportZip(doc(), { png: null })))
    expect(files).toContain(`${doc().meta.id}/param_picture.png`)
  })

  it("creates a clip parameter with the Other clip block and removes it with the block", () => {
    const s = useEditor.getState()
    const id = s.addNode("other_clip", 0, 0)
    expect(doc().params).toMatchObject([{ identifier: "otherClip", type: "clip" }])
    useEditor.getState().removeNodes([id])
    expect(doc().params).toEqual([])
  })

  it("renames a parameter everywhere it's referenced", () => {
    const s = useEditor.getState()
    s.exposeOption(node("gradient_ramp").id, "stops")
    expect(useEditor.getState().updateParam("gradient", { identifier: "heat" })).toBeNull()
    expect(node("gradient_ramp").data.stops).toEqual({ param: "heat" })
  })
})
