#version 300 es
in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;

out         vec4 vColor;
// Preserve N64 sub-texel precision before fragment-stage tile offsets.
out highp vec2 vUV;

void main(void) {
  gl_Position = aPosition;
  vColor = aColor;
  vUV = aUV;
}
