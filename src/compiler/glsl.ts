import type { Literal, SocketType } from "@/doc/types"

export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) return "0.0"
  const s = String(Number(n.toFixed(6)))
  return /[.e]/.test(s) ? s : `${s}.0`
}

export function glslType(t: SocketType): string {
  return t === "float" ? "float" : t === "vec2" ? "vec2" : "vec4"
}

export function glslLiteral(v: Literal, t: SocketType): string {
  if (typeof v === "boolean") v = v ? 1 : 0
  if (typeof v === "number") {
    if (t === "float") return glslFloat(v)
    if (t === "vec2") return `vec2(${glslFloat(v)})`
    return `vec4(vec3(${glslFloat(v)}), 1.0)`
  }
  if (v.length === 2) {
    if (t === "vec2") return `vec2(${glslFloat(v[0])}, ${glslFloat(v[1])})`
    if (t === "float") return glslFloat(v[0])
    return `vec4(${glslFloat(v[0])}, ${glslFloat(v[1])}, 0.0, 1.0)`
  }
  if (t === "color") return `vec4(${v.map(glslFloat).join(", ")})`
  if (t === "vec2") return `vec2(${glslFloat(v[0])}, ${glslFloat(v[1])})`
  return glslFloat(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2])
}

/** Converts between socket types. color → float uses luma(), so callers must include that helper. */
export function coerce(expr: string, from: SocketType, to: SocketType): string {
  if (from === to) return expr
  if (from === "float") return to === "vec2" ? `vec2(${expr})` : `vec4(vec3(${expr}), 1.0)`
  if (from === "vec2") return to === "float" ? `(${expr}).x` : `vec4(${expr}, 0.0, 1.0)`
  return to === "float" ? `luma(${expr})` : `(${expr}).xy`
}

export const GLSL_RESERVED = new Set(
  (
    "attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube struct common partition active asm class union enum typedef template this packed goto inline noinline volatile public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 filter sizeof cast namespace using " +
    // built-in functions a parameter name would shadow
    "radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize reflect refract texture transpose determinant inverse round trunc " +
    // file-scope names generated code declares; locals can't clash because parameters are read
    // through pv_<name>() accessors
    "hash11 hash21 hash22 valueNoise fbm over luma rgb2hsv hsv2rgb rot2 rotX rotY rotZ rot3 cross2 invBilinear rayQuad rgb2ycc blendOverlay blendSoftLight easeOutBounce main uv fragColor v_texCoord " +
    // Drift's mask prelude
    "driftMask u_clipMask u_hasClipMask"
  ).split(/\s+/),
)
