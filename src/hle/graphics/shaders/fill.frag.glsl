#version 300 es
precision mediump float;
uniform vec4 uFillColor;

out vec4 outCol;

void main(void) {
  outCol = uFillColor;
}
