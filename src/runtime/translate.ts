// Mirrors drift::gl::translateShaderSource on OpenGL ES (VideoEd/src/engine/GlRuntime.cpp): the
// package's #version line is replaced and highp defaults are prepended, exactly as on Android.
export function esSource(source: string, fragment = true): string {
  let body = source
  if (body.startsWith("#version")) {
    const nl = body.indexOf("\n")
    body = nl < 0 ? "" : body.slice(nl + 1)
  }
  let pre = "#version 300 es\nprecision highp float;\nprecision highp int;\n"
  if (fragment) pre += "precision highp sampler2D;\n"
  return pre + body
}

export const QUAD_VERTEX_SHADER = `#version 330 core
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`
