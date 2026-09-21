#version 300 es
precision mediump float;
in mediump vec2 vUV;
out vec4 outCol;

uniform sampler2D uSampler0;

void main(void) {
  vec4 col = texture(uSampler0, vUV);
  outCol = vec4(col.rgb, 1);
}
