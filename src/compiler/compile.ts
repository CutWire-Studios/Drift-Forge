import { isParamRef, type ForgeDoc, type ForgeEdge, type ForgeNode, type Kind, type ParamDef, type SocketType } from "@/doc/types"
import { nodeDef } from "@/nodes/registry"
import type { EmitCtx, EngineUniform, HelperName, NodeDef } from "@/nodes/types"
import { coerce, glslLiteral, glslType } from "./glsl"
import { resolveHelpers } from "./helpers"
import { validate, type CompileError } from "./validate"

export type { CompileError }

export type PassInput =
  | { type: "source_texture"; index?: number }
  | { type: "buffer"; id: string }
  | { type: "texture"; id: string }

export interface CompiledPass {
  file: string
  source: string
  inputs: PassInput[]
  output: { type: "canvas" } | { type: "buffer"; id: string }
  /**
   * Next Drift: parameters declared as sampler2D (image, clip, gradient, curve), bound by name to
   * the texture units after `inputs`, in this order.
   */
  paramSamplers: string[]
}

export interface LiteralUniform {
  name: string
  node: string
  input: string
  type: SocketType
}

export interface CompiledTexture {
  id: string
  assetId: string
  file: string
}

export interface CompileResult {
  ok: boolean
  errors: CompileError[]
  passes: CompiledPass[]
  buffers: string[]
  textures: CompiledTexture[]
  /** Preview mode only: unconnected inputs become uniforms so sliders don't recompile. */
  literals: LiteralUniform[]
  usesTime: boolean
}

export const SAMPLER_PARAM_TYPES = new Set(["image", "clip", "gradient", "curve"])

/** GLSL type a parameter is declared with. */
export function paramGlslType(p: ParamDef): string {
  switch (p.type) {
    case "color":
      return p.alpha ? "vec4" : "vec3"
    case "point":
      return "vec2"
    case "region":
      return "vec4"
    case "image":
    case "clip":
    case "gradient":
    case "curve":
      return "sampler2D"
    default:
      return "float"
  }
}

export interface CompileOptions {
  mode: "export" | "preview"
  /** Render this node output instead of the Output node (per-node previews). */
  target?: { node: string; output: string }
}

type TexRef = { kind: "source"; index: 0 | 1 } | { kind: "buffer"; sym: string } | { kind: "asset"; assetId: string }

interface PassBuild {
  key: string
  writes: string | null
  samplers: TexRef[]
  helpers: Set<HelperName>
  functions: string[]
  fnNames: Map<string, string>
  usesRes: boolean
  usesTime: boolean
  usesProgress: boolean
  params: Set<string>
  engines: Set<EngineUniform>
  literals: Map<string, LiteralUniform>
  main: string
}

class CompileFailure extends Error {
  constructor(public errors: CompileError[]) {
    super(errors[0]?.message ?? "compile failed")
  }
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, "")

export function compile(doc: ForgeDoc, opts: CompileOptions): CompileResult {
  const errors = validate(doc, { requireOutput: !opts.target })
  const empty: CompileResult = {
    ok: false,
    errors,
    passes: [],
    buffers: [],
    textures: [],
    literals: [],
    usesTime: false,
  }
  if (errors.length) return empty
  try {
    return new Compiler(doc, opts).run()
  } catch (e) {
    if (e instanceof CompileFailure) return { ...empty, errors: e.errors }
    throw e
  }
}

class Compiler {
  private nodes = new Map<string, ForgeNode>()
  private incoming = new Map<string, ForgeEdge>()
  private materialized = new Set<string>()
  private passes = new Map<string, PassBuild>()
  private order: PassBuild[] = []
  private building = new Set<string>()
  private usesTime = false
  private kind: Kind

  constructor(
    private doc: ForgeDoc,
    private opts: CompileOptions,
  ) {
    this.kind = doc.kind
    for (const n of doc.nodes) this.nodes.set(n.id, n)
    for (const e of doc.edges) this.incoming.set(`${e.to}:${e.toSocket}`, e)
  }

  run(): CompileResult {
    const rootNode = this.opts.target
      ? this.nodes.get(this.opts.target.node)!
      : this.doc.nodes.find((n) => nodeDef(n.type)?.output)!
    this.findMaterialized(rootNode.id)
    this.ensurePass("root")
    return this.assemble()
  }

  private def(node: ForgeNode): NodeDef {
    return nodeDef(node.type)!
  }

  private fail(node: string | undefined, message: string): never {
    throw new CompileFailure([{ node, message }])
  }

  private optOf(node: ForgeNode) {
    const def = this.def(node)
    return <T,>(id: string): T => {
      if (id in node.data) return node.data[id] as T
      const o = def.options?.find((o) => o.id === id)
      return (o && "default" in o ? o.default : undefined) as T
    }
  }

  private heavyInputs(node: ForgeNode): string[] {
    const h = this.def(node).heavyInputs
    if (!h) return []
    return typeof h === "function" ? h({ opt: this.optOf(node) }) : h
  }

  /** Values sampled many times per pixel get their own buffer, unless reading them is already cheap. */
  private findMaterialized(rootId: string) {
    const seen = new Set<string>()
    const visit = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      const node = this.nodes.get(id)!
      const heavy = new Set(this.heavyInputs(node))
      for (const input of this.def(node).inputs) {
        const e = this.incoming.get(`${id}:${input.id}`)
        if (!e) continue
        visit(e.from)
        if (heavy.has(input.id) && !this.def(this.nodes.get(e.from)!).cheap) {
          this.materialized.add(`${e.from}:${e.fromSocket}`)
        }
      }
    }
    visit(rootId)
  }

  private ensurePass(key: string): PassBuild {
    const existing = this.passes.get(key)
    if (existing) return existing
    if (this.building.has(key)) this.fail(undefined, "The graph loops back on itself.")
    this.building.add(key)
    const p: PassBuild = {
      key,
      writes: key === "root" ? null : key,
      samplers: [],
      helpers: new Set(),
      functions: [],
      fnNames: new Map(),
      usesRes: false,
      usesTime: false,
      usesProgress: false,
      params: new Set(),
      engines: new Set(),
      literals: new Map(),
      main: "",
    }

    if (key === "root") {
      if (this.opts.target) {
        const { node, output } = this.opts.target
        const t = this.outputType(this.nodes.get(node)!, output)
        p.main = coerce(`${this.valueFn(p, node, output)}(v_texCoord)`, t, "color")
      } else {
        const out = this.doc.nodes.find((n) => nodeDef(n.type)?.output)!
        p.main = this.ctx(p, out).in("image", "v_texCoord")
      }
    } else if (key.startsWith("mat:")) {
      const [node, output] = key.slice(4).split(":")
      p.main = coerce(`${this.valueFn(p, node, output)}(v_texCoord)`, this.outputType(this.nodes.get(node)!, output), "color")
    } else {
      const [, nodeId, k] = key.split(":")
      const node = this.nodes.get(nodeId)!
      const stage = Number(k)
      const ctx = this.ctx(p, node)
      const prev = stage > 0 ? this.bufferReader(p, `stage:${nodeId}:${stage - 1}`) : () => "vec4(0.0)"
      const body = this.def(node).stages![stage].body(ctx, prev)
      const fn = `s_${safe(nodeId)}_${stage}`
      p.functions.push(`vec4 ${fn}(vec2 uv) {\n    ${body}\n}`)
      p.main = `${fn}(v_texCoord)`
    }

    this.building.delete(key)
    this.passes.set(key, p)
    this.order.push(p)
    return p
  }

  private outputType(node: ForgeNode, output: string): SocketType {
    const o = this.def(node).outputs.find((o) => o.id === output)
    if (!o) this.fail(node.id, `Unknown output "${output}".`)
    return o.type
  }

  private sampler(p: PassBuild, ref: TexRef): string {
    let i = p.samplers.findIndex(
      (s) =>
        s.kind === ref.kind &&
        (s.kind === "source"
          ? s.index === (ref as { index: number }).index
          : s.kind === "buffer"
            ? s.sym === (ref as { sym: string }).sym
            : s.assetId === (ref as { assetId: string }).assetId),
    )
    if (i < 0) {
      p.samplers.push(ref)
      i = p.samplers.length - 1
    }
    return i === 0 ? "u_currentTexture" : `u_texture${i}`
  }

  private bufferReader(p: PassBuild, sym: string): (uv: string) => string {
    this.ensurePass(sym)
    const s = this.sampler(p, { kind: "buffer", sym })
    return (uv) => `texture(${s}, ${uv})`
  }

  /** Emits the function computing one node output inside pass `p` and returns its name. */
  private valueFn(p: PassBuild, nodeId: string, output: string): string {
    const key = `${nodeId}:${output}`
    const have = p.fnNames.get(key)
    if (have) return have
    const node = this.nodes.get(nodeId)!
    const def = this.def(node)
    const type = this.outputType(node, output)
    const ctx = this.ctx(p, node)
    const stage = def.stages ? this.bufferReader(p, `stage:${nodeId}:${def.stages.length - 1}`) : () => "vec4(0.0)"
    const bodies = def.emit(ctx, stage)
    const name = `n_${safe(nodeId)}_${safe(output)}`
    p.functions.push(`${glslType(type)} ${name}(vec2 uv) {\n    ${bodies[output]}\n}`)
    p.fnNames.set(key, name)
    return name
  }

  private ctx(p: PassBuild, node: ForgeNode): EmitCtx {
    const def = this.def(node)
    const prefix = `x_${safe(node.id)}`
    const declared = new Set<string>()
    const self = this
    const ctx: EmitCtx = {
      kind: this.kind,
      prefix,
      opt: this.optOf(node),
      connected: (id) => this.incoming.has(`${node.id}:${id}`),
      helper: (n) => {
        p.helpers.add(n)
      },
      clock: () => (self.kind === "effect" ? ctx.time() : ctx.progress()),
      time: () => {
        if (self.kind === "transition") {
          self.fail(node.id, "Transitions can't use Time. Use Progress instead, so the transition looks the same every time.")
        }
        p.usesTime = true
        self.usesTime = true
        return "u_time"
      },
      progress: () => {
        p.usesProgress = true
        return "u_progress"
      },
      res: () => {
        p.usesRes = true
        return "u_resolution"
      },
      source: (index, uv) => {
        if (self.kind === "effect" && index !== 0) self.fail(node.id, "Effects only have one clip.")
        return `texture(${self.sampler(p, { kind: "source", index })}, ${uv})`
      },
      optParam: (id) => {
        const v = node.data[id]
        if (!isParamRef(v) || Array.isArray(v.param)) return null
        self.useParam(p, node, v.param)
        return v.param
      },
      clip: (uv) => {
        const v = node.data.clip
        const name = isParamRef(v) && !Array.isArray(v.param) ? v.param : null
        if (!name) return self.fail(node.id, "This block lost its clip slider. Delete it and add it again.")
        self.useParam(p, node, name)
        return `texture(${name}, ${uv})`
      },
      engine: (name) => {
        p.engines.add(name)
        return name
      },
      asset: (uv, option = "asset") => {
        const ref = node.data[option]
        if (isParamRef(ref) && !Array.isArray(ref.param)) {
          // Picture parameters are uploaded like clip frames (next Drift), so no flip here.
          self.useParam(p, node, ref.param)
          return `texture(${ref.param}, ${uv})`
        }
        const assetId = ref as string | undefined
        if (!assetId || !self.doc.assets.some((a) => a.id === assetId)) {
          self.fail(node.id, "Pick a picture for this node.")
        }
        const s = self.sampler(p, { kind: "asset", assetId: assetId! })
        // Drift uploads package images flipped vertically (GlRuntime staticTexture), unlike video
        // frames, so v is mirrored here to keep 0 at the image's top row in both.
        return `texture(${s}, vec2((${uv}).x, 1.0 - (${uv}).y))`
      },
      declare: (text) => {
        if (declared.has(text)) return
        declared.add(text)
        p.functions.push(text)
      },
      in: (id, uv = "uv") => {
        const input = def.inputs.find((i) => i.id === id)
        if (!input) throw new Error(`${def.type} has no input ${id}`)
        const edge = this.incoming.get(`${node.id}:${id}`)
        if (edge) {
          const src = this.nodes.get(edge.from)!
          const srcType = this.outputType(src, edge.fromSocket)
          const vk = `${edge.from}:${edge.fromSocket}`
          if (this.materialized.has(vk) && p.key !== `mat:${vk}`) {
            const read = this.bufferReader(p, `mat:${vk}`)
            return coerce(read(uv), "color", input.type)
          }
          return coerce(`${this.valueFn(p, edge.from, edge.fromSocket)}(${uv})`, srcType, input.type)
        }
        if (input.clock) return ctx.clock()
        const v = node.inputs[id] ?? input.default
        if (isParamRef(v)) return this.paramExpr(p, node, v.param, input.type)
        if (this.opts.mode === "preview") {
          const name = `k_${safe(node.id)}_${safe(id)}`
          p.literals.set(name, { name, node: node.id, input: id, type: input.type })
          return name
        }
        return glslLiteral(v, input.type)
      },
    }
    return ctx
  }

  private useParam(p: PassBuild, node: ForgeNode, name: string): ParamDef {
    const def = this.doc.params.find((q) => q.identifier === name)
    if (!def) this.fail(node.id, `This node uses a slider "${name}" that no longer exists.`)
    p.params.add(name)
    return def
  }

  private paramExpr(p: PassBuild, node: ForgeNode, ref: string | [string, string], to: SocketType): string {
    if (Array.isArray(ref)) {
      this.useParam(p, node, ref[0])
      this.useParam(p, node, ref[1])
      return coerce(`vec2(pv_${ref[0]}(), pv_${ref[1]}())`, "vec2", to)
    }
    const def = this.useParam(p, node, ref)
    // Read through pv_<name>() so a local in generated code can never shadow the uniform.
    const v = `pv_${ref}()`
    switch (def.type) {
      case "color":
        return coerce(def.alpha ? v : `vec4(${v}, 1.0)`, "color", to)
      case "point":
        return coerce(v, "vec2", to)
      case "region":
      case "image":
      case "clip":
      case "gradient":
      case "curve":
        return this.fail(node.id, `"${def.displayName}" can't drive this setting.`)
      default:
        return coerce(v, "float", to)
    }
  }

  private assemble(): CompileResult {
    // Liveness: a buffer can be reused once every pass reading it has run, and never as the
    // target of a pass that also reads it.
    const lastUse = new Map<string, number>()
    this.order.forEach((p, i) => {
      for (const s of p.samplers) if (s.kind === "buffer") lastUse.set(s.sym, Math.max(lastUse.get(s.sym) ?? -1, i))
    })
    const physOf = new Map<string, string>()
    const holder: string[] = []
    this.order.forEach((p, i) => {
      if (!p.writes) return
      const reads = new Set(p.samplers.filter((s) => s.kind === "buffer").map((s) => physOf.get((s as { sym: string }).sym)))
      let slot = holder.findIndex((sym, b) => (lastUse.get(sym) ?? -1) < i && !reads.has(`buf${b}`))
      if (slot < 0) {
        holder.push(p.writes)
        slot = holder.length - 1
      } else holder[slot] = p.writes
      physOf.set(p.writes, `buf${slot}`)
    })

    const textures: CompiledTexture[] = []
    const texId = (assetId: string) => {
      let t = textures.find((t) => t.assetId === assetId)
      if (!t) {
        const asset = this.doc.assets.find((a) => a.id === assetId)!
        const ext = asset.mime === "image/jpeg" ? "jpg" : asset.mime === "image/webp" ? "webp" : "png"
        t = { id: `tex${textures.length}`, assetId, file: `tex${textures.length}.${ext}` }
        textures.push(t)
      }
      return t.id
    }

    const literals = new Map<string, LiteralUniform>()
    const multi = this.order.length > 1
    const passes: CompiledPass[] = this.order.map((p, i) => {
      if (p.samplers.length === 0) p.samplers.push({ kind: "source", index: 0 })
      for (const [k, v] of p.literals) literals.set(k, v)
      const inputs: PassInput[] = p.samplers.map((s) =>
        s.kind === "source"
          ? this.kind === "transition"
            ? { type: "source_texture", index: s.index }
            : { type: "source_texture" }
          : s.kind === "buffer"
            ? { type: "buffer", id: physOf.get(s.sym)! }
            : { type: "texture", id: texId(s.assetId) },
      )
      return {
        file: !multi || p.key === "root" ? "main.frag" : `pass${i + 1}.frag`,
        source: this.passSource(p),
        inputs,
        output: p.writes ? { type: "buffer", id: physOf.get(p.writes)! } : { type: "canvas" },
        paramSamplers: this.doc.params
          .filter((d) => p.params.has(d.identifier) && SAMPLER_PARAM_TYPES.has(d.type))
          .map((d) => d.identifier),
      }
    })

    return {
      ok: true,
      errors: [],
      passes,
      buffers: holder.map((_, i) => `buf${i}`),
      textures,
      literals: [...literals.values()],
      usesTime: this.usesTime,
    }
  }

  private passSource(p: PassBuild): string {
    const lines = ["#version 330 core", "in vec2 v_texCoord;", "out vec4 fragColor;", ""]
    p.samplers.forEach((_, i) => lines.push(`uniform sampler2D ${i === 0 ? "u_currentTexture" : `u_texture${i}`};`))
    if (p.usesRes) lines.push("uniform vec2 u_resolution;")
    if (p.usesTime) lines.push("uniform float u_time;")
    if (p.usesProgress) lines.push("uniform float u_progress;")
    for (const e of p.engines) lines.push(`uniform float ${e};`)
    const used = this.doc.params.filter((d) => p.params.has(d.identifier))
    for (const def of used) lines.push(`uniform ${paramGlslType(def)} ${def.identifier};`)
    for (const def of used) {
      const t = paramGlslType(def)
      if (t !== "sampler2D") lines.push(`${t} pv_${def.identifier}() { return ${def.identifier}; }`)
    }
    for (const l of p.literals.values()) lines.push(`uniform ${glslType(l.type)} ${l.name};`)
    lines.push("")
    if ([...p.functions, p.main].some((f) => f.includes("luma("))) p.helpers.add("luma")
    for (const h of resolveHelpers(p.helpers)) lines.push(h, "")
    for (const f of p.functions) lines.push(f, "")
    lines.push("void main() {", `    fragColor = ${p.main};`, "}", "")
    return lines.join("\n")
  }
}
