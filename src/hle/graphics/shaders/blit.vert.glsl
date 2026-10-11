#version 300 es
in vec4 aPosition;
in vec2 aUV;

out highp vec2 vUV;

void main(void) {
  gl_Position   = aPosition;
  vUV = aUV;
}
