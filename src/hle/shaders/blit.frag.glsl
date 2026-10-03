#version 300 es
precision highp float;
in mediump vec2 vUV;
out vec4 outCol;

uniform sampler2D uSampler0;
uniform int uCRTMode; // 0: off, 1: simple, 2: Mattias
uniform float uCRTTime;
uniform vec2 uOutputResolution;
uniform float uSourceHeight;

vec3 simpleCRT(vec2 screenUV);
vec3 mattiasCRT(vec2 screenUV);

void main(void) {
  vec3 color;
  switch (uCRTMode) {
    case 0:
      color = texture(uSampler0, vUV).rgb;
      break;
    case 1:
      color = simpleCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    case 2:
      color = mattiasCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    default:
      color = texture(uSampler0, vUV).rgb;
      break;
  }
  outCol = vec4(color, 1.0);
}
