import type { CompileResult } from "@/compiler/compile"
import type { ParamDef, ParamDefault, SocketType } from "@/doc/types"
import { hexToRgba } from "@/doc/util"
import { CLIP_MASK_UNIT, esSource, MASK_PRELUDE, QUAD_VERTEX_SHADER } from "./translate"

export type UniformValue = number | number[]

export interface FrameInput {
  width: number
  height: number
  /** seconds; Drift passes clip-relative time to effects */
  time: number
  progress: number
  params: ParamDef[]
  /** current slider values by identifier; falls back to each param's default */
  paramValues: Record<string, ParamDefault>
  literals: Record<string, UniformValue>
  /** Engine values only the next Drift provides (u_audioLevel…). */
  engine?: Record<string, number>
  /** Texture for a sampler parameter (image, clip, gradient, curve), by identifier. */
  paramTexture?: (identifier: string) => WebGLTexture | null
  /** The clip's mask coverage for "requires": "mask" packages; null means the clip has none. */
  clipMask?: WebGLTexture | null
}

interface Program {
  program: WebGLProgram
  locations: Map<string, WebGLUniformLocation | null>
}

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
  width: number
  height: number
}

/**
 * A WebGL2 copy of Drift's GPU package executor (GlRuntime::runPipeline): same quad and vertex
 * shader, same ES translation of package shaders, same uniform and texture-unit binding, RGBA8
 * buffers with CLAMP_TO_EDGE + LINEAR. Frames are stored with row 0 at the top, as in Drift.
 */
export class DriftRenderer {
  readonly gl: WebGL2RenderingContext
  private programs = new Map<string, Program | string>()
  private vao: WebGLVertexArrayObject
  private sources: (WebGLTexture | null)[] = [null, null, null]
  private dataTextures = new Map<string, { tex: WebGLTexture; key: string }>()
  private uprightAssets = new Map<string, WebGLTexture>()
  private assets = new Map<string, WebGLTexture>()
  private pool: Target[] = []
  private blit: Program

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, alpha: true })
    if (!gl) throw new Error("WebGL2 is not available in this browser.")
    this.gl = gl
    const quad = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1])
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8)
    gl.bindVertexArray(null)

    const blit = this.program(`#version 330 core
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_currentTexture;
void main() {
    vec4 c = texture(u_currentTexture, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
    // Checkerboard behind transparent pixels so cut-outs are visible.
    vec2 cell = floor(gl_FragCoord.xy / 8.0);
    vec3 bg = mix(vec3(0.16), vec3(0.22), mod(cell.x + cell.y, 2.0));
    fragColor = vec4(mix(bg, c.rgb, c.a), 1.0);
}
`)
    if (typeof blit === "string") throw new Error(blit)
    this.blit = blit
  }

  /** Compiles (or fetches) a package fragment shader; returns the error log on failure. */
  program(fragment: string, prelude = ""): Program | string {
    const key = prelude + fragment
    const cached = this.programs.get(key)
    if (cached) return cached
    const gl = this.gl
    const compileShader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) ?? "shader error"
        gl.deleteShader(s)
        return log
      }
      return s
    }
    const vs = compileShader(gl.VERTEX_SHADER, esSource(QUAD_VERTEX_SHADER, false))
    const fs = compileShader(gl.FRAGMENT_SHADER, esSource(fragment, true, prelude))
    let result: Program | string
    if (typeof vs === "string") result = vs
    else if (typeof fs === "string") result = fs
    else {
      const p = gl.createProgram()!
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      result = gl.getProgramParameter(p, gl.LINK_STATUS)
        ? { program: p, locations: new Map() }
        : (gl.getProgramInfoLog(p) ?? "link error")
    }
    if (this.programs.size > 400) this.dropPrograms()
    this.programs.set(key, result)
    return result
  }

  private dropPrograms() {
    for (const p of this.programs.values()) if (typeof p !== "string") this.gl.deleteProgram(p.program)
    this.programs.clear()
  }

  private texture(wrap: number): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    return t
  }

  /** Uploads a clip frame. Row 0 of the image lands at v=0, as Drift's source targets do. */
  /** Index 2 is the "other clip" a next-Drift clip parameter samples. */
  sourceTexture(index: number): WebGLTexture | null {
    return this.sources[index] ?? null
  }

  /** A picture parameter (next Drift): uploaded like clip frames, row 0 at v=0. */
  setUprightAsset(assetId: string, image: TexImageSource) {
    const gl = this.gl
    let t = this.uprightAssets.get(assetId)
    if (!t) {
      t = this.texture(gl.CLAMP_TO_EDGE)
      this.uprightAssets.set(assetId, t)
    }
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  uprightAsset(assetId: string): WebGLTexture | null {
    return this.uprightAssets.get(assetId) ?? null
  }

  /** A small RGBA8 lookup texture (gradients, curves), re-uploaded only when `key` changes. */
  dataTexture(name: string, key: string, pixels: () => Uint8Array, width: number): WebGLTexture {
    const gl = this.gl
    let entry = this.dataTextures.get(name)
    if (!entry) {
      entry = { tex: this.texture(gl.CLAMP_TO_EDGE), key: "" }
      this.dataTextures.set(name, entry)
    }
    if (entry.key !== key) {
      gl.bindTexture(gl.TEXTURE_2D, entry.tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels())
      entry.key = key
    }
    return entry.tex
  }

  setSource(index: 0 | 1 | 2, image: TexImageSource) {
    const gl = this.gl
    const t = (this.sources[index] ??= this.texture(gl.CLAMP_TO_EDGE))
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  /** Uploads a package image with GL_REPEAT, row 0 at v=0, matching GlRuntime's staticTexture. */
  setAsset(assetId: string, image: TexImageSource) {
    const gl = this.gl
    let t = this.assets.get(assetId)
    if (!t) {
      t = this.texture(gl.REPEAT)
      this.assets.set(assetId, t)
    }
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }

  hasAsset(assetId: string): boolean {
    return this.assets.has(assetId)
  }

  private acquire(width: number, height: number): Target {
    const i = this.pool.findIndex((t) => t.width === width && t.height === height)
    if (i >= 0) return this.pool.splice(i, 1)[0]
    const gl = this.gl
    const tex = this.texture(gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fbo, tex, width, height }
  }

  private release(t: Target) {
    this.pool.push(t)
    if (this.pool.length > 24) {
      const old = this.pool.shift()!
      this.gl.deleteFramebuffer(old.fbo)
      this.gl.deleteTexture(old.tex)
    }
  }

  private uniform(p: Program, name: string): WebGLUniformLocation | null {
    if (!p.locations.has(name)) p.locations.set(name, this.gl.getUniformLocation(p.program, name))
    return p.locations.get(name)!
  }

  private setValue(loc: WebGLUniformLocation | null, v: UniformValue, type?: SocketType | "vec3") {
    if (!loc) return
    const gl = this.gl
    if (typeof v === "number") gl.uniform1f(loc, v)
    else if (v.length === 2 || type === "vec2") gl.uniform2f(loc, v[0], v[1])
    else if (v.length === 3 || type === "vec3") gl.uniform3f(loc, v[0], v[1], v[2])
    else gl.uniform4f(loc, v[0], v[1], v[2], v[3])
  }

  /**
   * Runs the compiled pipeline. `assetOf` maps package texture ids to uploaded asset ids.
   * Returns the canvas-sized result target (caller must release) or an error string.
   */
  private runPipeline(compiled: CompileResult, frame: FrameInput, assetOf: (texId: string) => string): Target | string {
    const gl = this.gl
    const programs: Program[] = []
    for (const pass of compiled.passes) {
      const p = this.program(pass.source, compiled.usesMask ? MASK_PRELUDE : "")
      if (typeof p === "string") return p
      programs.push(p)
    }

    const buffers = new Map<string, Target>()
    for (const id of compiled.buffers) buffers.set(id, this.acquire(frame.width, frame.height))
    const canvas = this.acquire(frame.width, frame.height)

    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    compiled.passes.forEach((pass, i) => {
      const prog = programs[i]
      const out = pass.output.type === "canvas" ? canvas : buffers.get(pass.output.id)!
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo)
      gl.viewport(0, 0, out.width, out.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog.program)

      let inputSize: [number, number] = [frame.width, frame.height]
      pass.inputs.forEach((input, unit) => {
        let tex: WebGLTexture | null = null
        if (input.type === "source_texture") tex = this.sources[input.index ?? 0] ?? this.sources[0]
        else if (input.type === "buffer") {
          const b = buffers.get(input.id)!
          tex = b.tex
          if (unit === 0) inputSize = [b.width, b.height]
        } else tex = this.assets.get(assetOf(input.id)) ?? null
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        const loc = this.uniform(prog, unit === 0 ? "u_currentTexture" : `u_texture${unit}`)
        if (loc) gl.uniform1i(loc, unit)
      })

      this.setValue(this.uniform(prog, "u_resolution"), inputSize)
      this.setValue(this.uniform(prog, "u_time"), frame.time)
      this.setValue(this.uniform(prog, "u_timeUs"), frame.time * 1e6)
      this.setValue(this.uniform(prog, "u_progress"), Math.min(1, Math.max(0, frame.progress)))
      const fi = this.uniform(prog, "u_frameIndex")
      if (fi) gl.uniform1i(fi, Math.floor(frame.time * 30))

      pass.paramSamplers.forEach((id, i) => {
        const unit = pass.inputs.length + i
        gl.activeTexture(gl.TEXTURE0 + unit)
        gl.bindTexture(gl.TEXTURE_2D, frame.paramTexture?.(id) ?? null)
        const loc = this.uniform(prog, id)
        if (loc) gl.uniform1i(loc, unit)
      })
      for (const [name, v] of Object.entries(frame.engine ?? {})) this.setValue(this.uniform(prog, name), v)
      if (compiled.usesMask) {
        gl.activeTexture(gl.TEXTURE0 + CLIP_MASK_UNIT)
        gl.bindTexture(gl.TEXTURE_2D, frame.clipMask ?? null)
        gl.activeTexture(gl.TEXTURE0)
        const loc = this.uniform(prog, "u_clipMask")
        if (loc) gl.uniform1i(loc, CLIP_MASK_UNIT)
        this.setValue(this.uniform(prog, "u_hasClipMask"), frame.clipMask ? 1 : 0)
      }

      for (const def of frame.params) {
        const v = frame.paramValues[def.identifier] ?? def.default
        const loc = this.uniform(prog, def.identifier)
        if (!loc) continue
        switch (def.type) {
          case "color": {
            const c = hexToRgba(String(v))
            if (def.alpha) this.setValue(loc, c, "color")
            else this.setValue(loc, c.slice(0, 3), "vec3")
            break
          }
          case "point":
            this.setValue(loc, v as number[], "vec2")
            break
          case "region":
            this.setValue(loc, v as number[], "color")
            break
          case "image":
          case "clip":
          case "gradient":
          case "curve":
            break
          default:
            this.setValue(loc, typeof v === "boolean" ? (v ? 1 : 0) : Number(v))
        }
      }
      for (const l of compiled.literals) {
        const v = frame.literals[l.name]
        if (v !== undefined) this.setValue(this.uniform(prog, l.name), v, l.type)
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
    gl.bindVertexArray(null)
    for (const b of buffers.values()) this.release(b)
    return canvas
  }

  /**
   * Renders into the bottom-left corner of the GL canvas, which only ever grows so switching
   * between preview sizes doesn't reallocate it. Copy out with drawImage(canvas, ...rect).
   * Returns the source rect in canvas pixels, or an error log.
   */
  render(
    compiled: CompileResult,
    frame: FrameInput,
    assetOf: (texId: string) => string,
  ): { sx: number; sy: number; w: number; h: number } | string {
    const result = this.runPipeline(compiled, frame, assetOf)
    if (typeof result === "string") return result
    const gl = this.gl
    if (this.canvas.width < frame.width || this.canvas.height < frame.height) {
      this.canvas.width = Math.max(this.canvas.width, frame.width)
      this.canvas.height = Math.max(this.canvas.height, frame.height)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, frame.width, frame.height)
    gl.useProgram(this.blit.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, result.tex)
    gl.uniform1i(this.uniform(this.blit, "u_currentTexture"), 0)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    this.release(result)
    return { sx: 0, sy: this.canvas.height - frame.height, w: frame.width, h: frame.height }
  }

  /** Renders and reads back straight-alpha RGBA, top row first (ready for ImageData). */
  readPixels(compiled: CompileResult, frame: FrameInput, assetOf: (texId: string) => string): ImageData | string {
    const result = this.runPipeline(compiled, frame, assetOf)
    if (typeof result === "string") return result
    const gl = this.gl
    const px = new Uint8ClampedArray(frame.width * frame.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, result.fbo)
    gl.readPixels(0, 0, frame.width, frame.height, gl.RGBA, gl.UNSIGNED_BYTE, px)
    this.release(result)
    return new ImageData(px, frame.width, frame.height)
  }
}
