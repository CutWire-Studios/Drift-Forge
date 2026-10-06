import { KIND_INFO } from "@/core/doc/kinds"
import { isParamRef, type ForgeDoc, type ForgeEdge, type ForgeNode, type Kind, type ParamDef, type ParamType, type SocketType } from "@/core/doc/types"
import { validateRack } from "@/core/audio/rack"
import { nodeDef, requireNodeDef } from "@/core/nodes/registry"
import type { EmitCtx, NodeDef } from "@/core/nodes/types"
import { coerce, glslLiteral, glslType } from "@/core/glsl/literals"
import { assemble } from "./assemble"
import { samplerName, type CompileOptions, type CompileResult, type PassBuild, type TexRef } from "./passes"
import { validate, type CompileError } from "./validate"

export type { CompileError }
export type { CompiledPass, CompiledTexture, CompileOptions, CompileResult, LiteralUniform, PassInput } from "./passes"

class CompileFailure extends Error {
  constructor(public errors: CompileError[]) {
    super(errors[0]?.message ?? "compile failed")
  }
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9]/g, "")

const TEX_KEY: { [K in TexRef["kind"]]: (r: Extract<TexRef, { kind: K }>) => string } = {
  source: (r) => `source:${r.index}`,
  buffer: (r) => `buffer:${r.sym}`,
  asset: (r) => `asset:${r.assetId}`,
}
const texKey = (r: TexRef) => (TEX_KEY[r.kind] as (r: TexRef) => string)(r)

/**
 * How a node input reads a parameter: the expression and its socket type, or null for types that
 * can't drive an input. Read through pv_<name>() so a local in generated code can never shadow the
 * uniform.
 */
const PARAM_READ: Record<ParamType, ((v: string, def: ParamDef) => [string, SocketType]) | null> = {
  float: (v) => [v, "float"],
  bool: (v) => [v, "float"],
  int: (v) => [v, "float"],
  choice: (v) => [v, "float"],
  seed: (v) => [v, "float"],
  color: (v, def) => [def.alpha ? v : `vec4(${v}, 1.0)`, "color"],
  point: (v) => [v, "vec2"],
  region: null,
  image: null,
  clip: null,
  gradient: null,
  curve: null,
}

export function compile(doc: ForgeDoc, opts: CompileOptions): CompileResult {
  // An audio effect has no node graph and no shader; Drift builds its pedalboard itself, so there is
  // only the board to check.
  if (doc.kind === "audio") {
    const errors = validateRack(doc).map((message) => ({ message }))
    return { ok: errors.length === 0, errors, passes: [], buffers: [], textures: [], literals: [], usesTime: false }
  }
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
  private usesMask = false
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
    return assemble(this.doc, this.order, { usesTime: this.usesTime, usesMask: this.usesMask })
  }

  private def(node: ForgeNode): NodeDef {
    return requireNodeDef(node.type)
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

    p.main = this.passMain(p, key)
    this.building.delete(key)
    this.passes.set(key, p)
    this.order.push(p)
    return p
  }

  /** The expression the pass writes: the graph's output, one materialized value, or one stage. */
  private passMain(p: PassBuild, key: string): string {
    if (key === "root") return this.rootMain(p)
    if (key.startsWith("mat:")) {
      const [node, output] = key.slice(4).split(":")
      return this.nodeOutputMain(p, node, output)
    }
    return this.stageMain(p, key)
  }

  private rootMain(p: PassBuild): string {
    if (this.opts.target) return this.nodeOutputMain(p, this.opts.target.node, this.opts.target.output)
    const out = this.doc.nodes.find((n) => nodeDef(n.type)?.output)!
    return this.ctx(p, out).in("image", "v_texCoord")
  }

  private nodeOutputMain(p: PassBuild, node: string, output: string): string {
    const t = this.outputType(this.nodes.get(node)!, output)
    return coerce(`${this.valueFn(p, node, output)}(v_texCoord)`, t, "color")
  }

  private stageMain(p: PassBuild, key: string): string {
    const [, nodeId, k] = key.split(":")
    const node = this.nodes.get(nodeId)!
    const stage = Number(k)
    const ctx = this.ctx(p, node)
    const prev = stage > 0 ? this.bufferReader(p, `stage:${nodeId}:${stage - 1}`) : () => "vec4(0.0)"
    const body = this.def(node).stages![stage].body(ctx, prev)
    const fn = `s_${safe(nodeId)}_${stage}`
    p.functions.push(`vec4 ${fn}(vec2 uv) {\n    ${body}\n}`)
    return `${fn}(v_texCoord)`
  }

  private outputType(node: ForgeNode, output: string): SocketType {
    const o = this.def(node).outputs.find((o) => o.id === output)
    if (!o) this.fail(node.id, `Unknown output "${output}".`)
    return o.type
  }

  private sampler(p: PassBuild, ref: TexRef): string {
    const key = texKey(ref)
    let i = p.samplers.findIndex((s) => texKey(s) === key)
    if (i < 0) {
      p.samplers.push(ref)
      i = p.samplers.length - 1
    }
    return samplerName(i)
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
    const declared = new Set<string>()
    const timing = this.timingCtx(p, node)
    return {
      kind: this.kind,
      prefix: `x_${safe(node.id)}`,
      opt: this.optOf(node),
      connected: (id) => this.incoming.has(`${node.id}:${id}`),
      helper: (n) => {
        p.helpers.add(n)
      },
      engine: (name) => {
        p.engines.add(name)
        return name
      },
      declare: (text) => {
        if (declared.has(text)) return
        declared.add(text)
        p.functions.push(text)
      },
      ...timing,
      ...this.textureCtx(p, node),
      in: (id, uv = "uv") => this.readInput(p, node, id, uv, timing.clock),
    }
  }

  private timingCtx(p: PassBuild, node: ForgeNode): Pick<EmitCtx, "clock" | "time" | "progress" | "res" | "aspect"> {
    const time = () => {
      if (this.kind === "transition") {
        this.fail(node.id, "Transitions can't use Time. Use Progress instead, so the transition looks the same every time.")
      }
      p.usesTime = true
      this.usesTime = true
      return "u_time"
    }
    const progress = () => {
      p.usesProgress = true
      return "u_progress"
    }
    const res = () => {
      p.usesRes = true
      return "u_resolution"
    }
    return {
      clock: () => (KIND_INFO[this.kind].clock === "time" ? time() : progress()),
      time,
      progress,
      res,
      aspect: () => `${res()}.x / max(${res()}.y, 1.0)`,
    }
  }

  private textureCtx(p: PassBuild, node: ForgeNode): Pick<EmitCtx, "source" | "optParam" | "clip" | "mask" | "hasMask" | "asset"> {
    return {
      source: (index, uv) => {
        if (this.kind === "effect" && index !== 0) this.fail(node.id, "Effects only have one clip.")
        return `texture(${this.sampler(p, { kind: "source", index })}, ${uv})`
      },
      optParam: (id) => {
        const v = node.data[id]
        if (!isParamRef(v) || Array.isArray(v.param)) return null
        this.useParam(p, node, v.param)
        return v.param
      },
      clip: (uv) => {
        const v = node.data.clip
        if (!isParamRef(v) || Array.isArray(v.param)) return this.fail(node.id, "This block lost its clip slider. Delete it and add it again.")
        this.useParam(p, node, v.param)
        return `texture(${v.param}, ${uv})`
      },
      mask: (uv) => {
        this.usesMask = true
        return `driftMask(${uv})`
      },
      hasMask: () => {
        this.usesMask = true
        return "u_hasClipMask"
      },
      asset: (uv, option = "asset") => {
        const ref = node.data[option]
        if (isParamRef(ref) && !Array.isArray(ref.param)) {
          this.useParam(p, node, ref.param)
          return `texture(${ref.param}, ${uv})`
        }
        const assetId = ref as string | undefined
        if (!assetId || !this.doc.assets.some((a) => a.id === assetId)) return this.fail(node.id, "Pick a picture for this node.")
        return `texture(${this.sampler(p, { kind: "asset", assetId })}, ${uv})`
      },
    }
  }

  /** An input as a GLSL expression of its own type: wired, a clock, a slider, or a literal. */
  private readInput(p: PassBuild, node: ForgeNode, id: string, uv: string, clock: () => string): string {
    const def = this.def(node)
    const input = def.inputs.find((i) => i.id === id)
    if (!input) throw new Error(`${def.type} has no input ${id}`)
    const edge = this.incoming.get(`${node.id}:${id}`)
    if (edge) return this.readEdge(p, edge, uv, input.type)
    if (input.clock) return clock()
    const v = node.inputs[id] ?? input.default
    if (isParamRef(v)) return this.paramExpr(p, node, v.param, input.type)
    if (this.opts.mode === "export") return glslLiteral(v, input.type)
    const name = `k_${safe(node.id)}_${safe(id)}`
    p.literals.set(name, { name, node: node.id, input: id, type: input.type })
    return name
  }

  private readEdge(p: PassBuild, edge: ForgeEdge, uv: string, to: SocketType): string {
    const srcType = this.outputType(this.nodes.get(edge.from)!, edge.fromSocket)
    const vk = `${edge.from}:${edge.fromSocket}`
    if (this.materialized.has(vk) && p.key !== `mat:${vk}`) {
      const read = this.bufferReader(p, `mat:${vk}`)
      return coerce(read(uv), "color", to)
    }
    return coerce(`${this.valueFn(p, edge.from, edge.fromSocket)}(${uv})`, srcType, to)
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
    const read = PARAM_READ[def.type]
    if (!read) return this.fail(node.id, `"${def.displayName}" can't drive this setting.`)
    const [expr, type] = read(`pv_${ref}()`, def)
    return coerce(expr, type, to)
  }

  /**
   * Maps each buffer symbol to a physical buffer. Liveness: a buffer can be reused once every pass
   * reading it has run, and never as the target of a pass that also reads it.
   */
}
