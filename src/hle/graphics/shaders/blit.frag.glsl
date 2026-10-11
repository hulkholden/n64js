#version 300 es
precision highp float;
in highp vec2 vUV;
out vec4 outCol;

uniform sampler2D uSampler0;
uniform sampler2D uSampler1;
uniform bool uInterlaced;
uniform vec2 uVIResolution; // field parity follows VI rows, not canvas pixels
uniform int uCRTMode; // 0: off, 1: simple, 2: Mattias
uniform float uCRTCurvature;
uniform float uCRTTime;
uniform vec2 uOutputResolution;
uniform float uSourceHeight;
uniform vec4 uSourceUV[2]; // scale.xy, offset.xy from screen UV to each field
uniform vec4 uSourceBounds[2]; // each field's visible rectangle, including VI borders
uniform bool uSourceVI;

bool outsideSourceBounds(vec2 uv, vec4 bounds) {
  return any(lessThan(uv, bounds.xy)) || any(greaterThanEqual(uv, bounds.zw));
}

vec3 sampleNearest(sampler2D source, vec2 uv, vec4 transform, vec4 bounds) {
  if (outsideSourceBounds(uv, bounds)) {
    return vec3(0.0);
  }
  vec2 sourceUV = uv * transform.xy + transform.zw;
  if (uSourceVI) {
    ivec2 size = textureSize(source, 0);
    // Match VI integer fetches. The epsilon absorbs floating-point error at
    // exact texel boundaries, below the VI's smallest fractional step.
    vec2 sourcePixel = vec2(sourceUV.x, 1.0 - sourceUV.y) * vec2(size);
    ivec2 pixel = ivec2(floor(sourcePixel + 0.0001));
    pixel.y = size.y - 1 - pixel.y;
    return texelFetch(source, clamp(pixel, ivec2(0), size - 1), 0).rgb;
  }
  return texture(source, sourceUV).rgb;
}

vec3 sampleFiltered(sampler2D source, vec2 uv, vec4 transform, vec4 bounds) {
  if (outsideSourceBounds(uv, bounds)) {
    return vec3(0.0);
  }
  vec2 sourceUV = uv * transform.xy + transform.zw;
  if (uSourceVI) {
    // Smooth CRT reconstruction samples around native pixel centres.
    sourceUV += vec2(0.5, -0.5) / vec2(textureSize(source, 0));
  }
  return texture(source, sourceUV).rgb;
}

vec3 sampleSourceNearest(vec2 uv) {
  if (uInterlaced) {
    // Stabilize exact row boundaries at fractional canvas scales.
    vec2 pixel = floor(uv * uVIResolution + 0.0001);
    pixel.y = uVIResolution.y - 1.0 - pixel.y;
    // Reconstruct VI pixel centres so enlarging the canvas cannot change which
    // source pixel or field supplies a scanline.
    uv = (pixel + 0.5) / uVIResolution;
    uv.y = 1.0 - uv.y;
    if ((int(pixel.y) & 1) != 0) {
      return sampleNearest(uSampler1, uv, uSourceUV[1], uSourceBounds[1]);
    }
  }
  return sampleNearest(uSampler0, uv, uSourceUV[0], uSourceBounds[0]);
}

vec3 sampleFieldRow(vec2 uv, int row) {
  uv.y = 1.0 - (float(row) + 0.5) / uVIResolution.y;
  if ((row & 1) != 0) {
    return sampleFiltered(uSampler1, uv, uSourceUV[1], uSourceBounds[1]);
  }
  return sampleFiltered(uSampler0, uv, uSourceUV[0], uSourceBounds[0]);
}

vec3 sampleSourceFiltered(vec2 uv) {
  if (uInterlaced) {
    // CRT taps arrive after distortion. Reconstruct the neighbouring VI rows
    // from their respective fields before filtering between them.
    float row = (1.0 - uv.y) * uVIResolution.y - 0.5;
    int first = int(floor(row));
    return mix(sampleFieldRow(uv, first), sampleFieldRow(uv, first + 1), fract(row));
  }
  return sampleFiltered(uSampler0, uv, uSourceUV[0], uSourceBounds[0]);
}

vec3 simpleCRT(vec2 screenUV);
vec3 mattiasCRT(vec2 screenUV);

void main(void) {
  vec3 color;
  switch (uCRTMode) {
    case 0:
      color = sampleSourceNearest(vUV);
      break;
    case 1:
      color = simpleCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    case 2:
      color = mattiasCRT(gl_FragCoord.xy / uOutputResolution);
      break;
    default:
      color = sampleSourceNearest(vUV);
      break;
  }
  outCol = vec4(color, 1.0);
}
