import { describe, expect, it } from "vitest"
import { compile, type CompileResult } from "@/core/compiler/compile"
import { packageJson } from "@/core/compiler/manifest"
import { paramNameProblem } from "@/core/doc/naming"
import { createNode } from "@/core/nodes/registry"
import { STARTERS } from "@/core/starters"
import { chain } from "./helpers"

/** Every buffer read must have been written earlier and not overwritten since; no pass reads its own target. */
function checkBufferFlow(r: CompileResult) {
  const holder = new Map<string, number>()
  r.passes.forEach((p, i) => {
    for (const input of p.inputs) {
      if (input.type !== "buffer") continue
      expect(holder.has(input.id), `pass ${i} reads ${input.id} before it is written`).toBe(true)
      if (p.output.type === "buffer") expect(p.output.id).not.toBe(input.id)
    }
    if (p.output.type === "buffer") holder.set(p.output.id, i)
  })
  expect(r.passes.at(-1)!.output.type).toBe("canvas")
}

describe("compiler", () => {
  for (const s of STARTERS) {
    it(`compiles starter "${s.name}"`, () => {
      const r = compile(s.doc, { mode: "export" })
      expect(r.errors).toEqual([])
      checkBufferFlow(r)
      for (const p of r.passes) expect(p.source.startsWith("#version 330 core\n")).toBe(true)
    })
  }

  it("renders a heavy node's expensive input to a buffer and reuses buffers", () => {
    const r = compile(chain("effect", ["twirl", "blur"]), { mode: "export" })
    expect(r.ok).toBe(true)
    // twirl → buffer, blur H, blur V, output
    expect(r.passes.length).toBe(4)
    expect(r.buffers.length).toBe(2)
    checkBufferFlow(r)
  })

  it("reads a cheap source directly instead of copying it to a buffer", () => {
    const r = compile(chain("effect", ["blur"]), { mode: "export" })
    expect(r.passes.length).toBe(3)
    expect(r.passes[0].inputs).toEqual([{ type: "source_texture" }])
  })

  it("chains many stage nodes without running out of buffers", () => {
    const r = compile(chain("effect", ["glow", "twirl", "blur", "zoom_blur", "glow", "sharpen"]), { mode: "export" })
    expect(r.ok).toBe(true)
    checkBufferFlow(r)
    expect(r.buffers.length).toBeLessThanOrEqual(3)
  })

  it("names a single pass main.frag and binds transition sources by index", () => {
    const s = STARTERS.find((s) => s.name === "Blank transition")!
    const r = compile(s.doc, { mode: "export" })
    expect(r.passes.map((p) => p.file)).toEqual(["main.frag"])
    expect(r.passes[0].inputs).toEqual([
      { type: "source_texture", index: 0 },
      { type: "source_texture", index: 1 },
    ])
    expect(r.passes[0].source).toContain("uniform float u_progress;")
    expect(r.passes[0].source).not.toContain("u_time")
  })

  it("refuses time in transitions", () => {
    const doc = chain("transition", ["grain"])
    expect(compile(doc, { mode: "export" }).ok).toBe(true)
    doc.nodes.push(createNode("time", 0, 0))
    const r = compile(doc, { mode: "export" })
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toMatch(/can't be used in a transition/)
  })

  it("inlines literals for export and turns them into uniforms for preview", () => {
    const doc = chain("effect", ["saturation"])
    const exp = compile(doc, { mode: "export" })
    expect(exp.literals).toEqual([])
    expect(exp.passes[0].source).toContain("1.0)")
    const prev = compile(doc, { mode: "preview" })
    expect(prev.literals.map((l) => l.input)).toEqual(["amount"])
  })

  it("binds exposed inputs to parameter uniforms with Drift's types", () => {
    const s = STARTERS.find((s) => s.name === "Duotone")!
    const r = compile(s.doc, { mode: "export" })
    expect(r.passes[0].source).toContain("uniform vec3 shadowColor;")
    const json = packageJson(s.doc, r) as { parameters: Record<string, unknown>[]; backend: string }
    expect(json.backend).toBe("gpu")
    expect(json.parameters[0]).toEqual({
      identifier: "shadowColor",
      displayName: "Shadows",
      type: "color",
      defaultValue: "#1b1446",
    })
  })

  it("reports a missing output", () => {
    const doc = chain("effect", [])
    doc.nodes = doc.nodes.filter((n) => n.type !== "effect_output")
    doc.edges = []
    expect(compile(doc, { mode: "export" }).errors[0].message).toMatch(/Output/)
  })

  it("rejects reserved and unsafe parameter names", () => {
    expect(paramNameProblem("amount")).toBeNull()
    expect(paramNameProblem("u_time")).not.toBeNull()
    expect(paramNameProblem("min")).not.toBeNull()
    expect(paramNameProblem("2fast")).not.toBeNull()
    expect(paramNameProblem("pv_amount")).not.toBeNull()
    expect(paramNameProblem("fbm")).not.toBeNull()
  })
})
