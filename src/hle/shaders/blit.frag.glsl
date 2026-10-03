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
  if (uCRTMode == 0) {
    outCol = vec4(texture(uSampler0, vUV).rgb, 1.0);
    return;
  }

  if (uCRTMode == 2) {
    outCol = vec4(mattiasCRT(gl_FragCoord.xy / uOutputResolution), 1.0);
    return;
  }

  outCol = vec4(simpleCRT(gl_FragCoord.xy / uOutputResolution), 1.0);
}
