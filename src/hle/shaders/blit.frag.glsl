#version 300 es
precision highp float;
in highp vec2 vUV;
out vec4 outCol;

uniform sampler2D uSampler0;
uniform int uCRTMode; // 0: off, 1: simple, 2: Mattias
uniform float uCRTTime;
uniform vec2 uOutputResolution;
uniform float uSourceHeight;
uniform vec4 uSourceUV; // scale.xy, offset.xy from screen UV to source UV
uniform vec4 uSourceBounds; // visible screen rectangle, including VI borders
uniform bool uSourceVI;

vec3 sampleSource(vec2 uv) {
  if (any(lessThan(uv, uSourceBounds.xy)) || any(greaterThanEqual(uv, uSourceBounds.zw))) {
    return vec3(0.0);
  }
  vec2 sourceUV = uv * uSourceUV.xy + uSourceUV.zw;
  if (uSourceVI) {
    ivec2 size = textureSize(uSampler0, 0);
    if (uCRTMode == 0) {
      // Match VI integer fetches. The epsilon absorbs floating-point error at
      // exact texel boundaries, below the VI's smallest fractional step.
      vec2 sourcePixel = vec2(sourceUV.x, 1.0 - sourceUV.y) * vec2(size);
      ivec2 pixel = ivec2(floor(sourcePixel + 0.0001));
      pixel.y = size.y - 1 - pixel.y;
      return texelFetch(uSampler0, clamp(pixel, ivec2(0), size - 1), 0).rgb;
    }
    // Smooth CRT reconstruction samples around native pixel centres.
    sourceUV += vec2(0.5, -0.5) / vec2(size);
  }
  return texture(uSampler0, sourceUV).rgb;
}

vec3 simpleCRT(vec2 screenUV);
vec3 mattiasCRT(vec2 screenUV);

void main(void) {
  vec3 color;
  switch (uCRTMode) {
    case 0:
      color = sampleSource(vUV);
      break;
    case 1:
      color = simpleCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    case 2:
      color = mattiasCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    default:
      color = sampleSource(vUV);
      break;
  }
  outCol = vec4(color, 1.0);
}
