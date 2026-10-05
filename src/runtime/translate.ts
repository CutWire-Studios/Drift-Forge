// Mirrors drift::gl::translateShaderSource on OpenGL ES (VideoEd/src/engine/GlRuntime.cpp): the
// package's #version line is replaced and highp defaults are prepended, exactly as on Android.
export function esSource(source: string, fragment = true, prelude = ""): string {
  let body = source
  if (body.startsWith("#version")) {
    const nl = body.indexOf("\n")
    body = nl < 0 ? "" : body.slice(nl + 1)
  }
  let pre = "#version 300 es\nprecision highp float;\nprecision highp int;\n"
  if (fragment) pre += "precision highp sampler2D;\n"
  return pre + prelude + body
}

/**
 * Drift's prelude for "requires": "mask" packages (kMaskPrelude in GlRuntime.cpp), compiled in
 * before every pass. Package shaders call driftMask() without declaring it.
 */
export const MASK_PRELUDE = `
uniform sampler2D u_clipMask;
uniform float u_hasClipMask;

float driftMask(vec2 uv)
{
    return u_hasClipMask > 0.5 ? texture(u_clipMask, uv).r : 0.0;
}
`

/** Desktop GLSL with the mask prelude spliced in after the version line, as Drift compiles it. */
export function withMaskPrelude(source: string): string {
  const nl = source.indexOf("\n")
  return source.startsWith("#version") ? source.slice(0, nl + 1) + MASK_PRELUDE + source.slice(nl + 1) : MASK_PRELUDE + source
}

/** The texture unit Drift binds the clip mask to (kClipMaskTextureUnit). */
export const CLIP_MASK_UNIT = 9

export const QUAD_VERTEX_SHADER = `#version 330 core
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`
