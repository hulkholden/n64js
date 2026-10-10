
/*
Mattias CRT presentation, adapted from crtemu_pc.h by Mattias Gustavsson:
https://github.com/mattiasgustavsson/crtview/blob/de7897958ac1f346ca7fa3dbf5a57dab5fcc5bb3/source/crtemu_pc.h
Visual reference: MattiasCRT, https://www.shadertoy.com/view/Ms23DR

n64js adaptation: one presentation pass, spatial ghosts sampled from the current
frame, VI-based animated scanlines, and no frame overlay or temporal blur buffers.
The original offers MIT or public domain licensing; this adaptation uses MIT.

Copyright (c) 2016 Mattias Gustavsson

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

vec2 mattiasCurve(vec2 uv) {
  vec2 flatUV = uv;
  uv = (uv - 0.5) * 2.0;
  uv *= 1.1;
  uv.x *= 1.0 + pow(abs(uv.y) / 5.0, 2.0);
  uv.y *= 1.0 + pow(abs(uv.x) / 4.0, 2.0);
  // Blend the complete transform so zero curvature also removes its zoom.
  return mix(flatUV, uv * (0.5 * 0.92) + 0.5, uCRTCurvature);
}

vec3 mattiasSample(vec2 uv) {
  return pow(sampleSourceFiltered(uv), vec3(2.2)) * 1.25;
}

vec3 mattiasFilmic(vec3 color) {
  vec3 x = max(vec3(0.0), color - 0.004);
  return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

vec3 mattiasCRT(vec2 screenUV) {
  vec2 uv = mattiasCurve(screenUV);
  float row = uv.y * uSourceHeight;
  float scanlineWeight = 1.0 - smoothstep(0.5, 1.0, fwidth(row));
  vec2 edge = smoothstep(vec2(0.0), fwidth(uv), uv)
            * (1.0 - smoothstep(vec2(1.0) - fwidth(uv), vec2(1.0), uv));

  // Reject the curved border before the fractional powers in the vignette.
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    return vec3(0.0);
  }

  float wobble = sin(0.1 * uCRTTime + uv.y * 13.0)
               * sin(0.23 * uCRTTime + uv.y * 19.0)
               * sin(0.3 + 0.11 * uCRTTime + uv.y * 23.0) * 0.0012;
  vec2 sampleUV = uv + vec2(wobble, 0.0);
  vec3 color;
  color.r = mattiasSample(sampleUV + vec2(0.0009, 0.0009)).r + 0.02;
  color.g = mattiasSample(sampleUV + vec2(0.0, -0.0011)).g + 0.02;
  color.b = mattiasSample(sampleUV + vec2(-0.0015, 0.0)).b + 0.02;

  // Offset copies suggest signal ghosting without retaining previous frames.
  vec3 ghost;
  ghost.r = mattiasSample(sampleUV + vec2(-0.014, -0.027) * 0.45).r;
  ghost.g = mattiasSample(sampleUV + vec2(-0.019, -0.020) * 0.45).g;
  ghost.b = mattiasSample(sampleUV + vec2(-0.017, -0.003) * 0.35).b;
  float intensity = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  intensity = intensity * intensity * 0.85 + 0.15;
  color += 0.05 * (1.0 - vec3(0.299, 0.587, 0.114))
         * pow(clamp(3.0 * ghost, 0.0, 1.0), vec3(2.0)) * intensity;

  color *= vec3(0.95, 1.05, 0.95);
  color = clamp(color * 1.3 + 0.75 * color * color + 1.25 * pow(color, vec3(5.0)), 0.0, 10.0);
  float vignette = 0.1 + 16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
  color *= 1.3 * sqrt(vignette);

  float scans = 0.35 + 0.18 * scanlineWeight * sin(row * 6.28318530718 + 3.5 * uCRTTime);
  color *= pow(scans, 0.9);
  color *= 1.0 - 0.23 * clamp(mod(gl_FragCoord.x, 3.0) / 2.0, 0.0, 1.0);
  color = mattiasFilmic(color);
  color *= 1.0 - 0.004 * (sin(50.0 * uCRTTime + uv.y * 2.0) * 0.5 + 0.5);
  return color * edge.x * edge.y;
}
