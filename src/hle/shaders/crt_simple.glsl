vec3 simpleCRT(vec2 screenUV) {
  // Use output pixels for the mask and native VI rows for the scanlines.
  vec2 position = screenUV * 2.0 - 1.0;
  vec2 curved = position * (1.0 + 0.025 * position.yx * position.yx);
  vec2 uv = curved * 0.5 + 0.5;
  vec3 color = sampleSource(uv);

  // Fade scanlines when the output cannot resolve them to avoid moire.
  float row = uv.y * uSourceHeight;
  float scanlineWeight = 1.0 - smoothstep(0.5, 1.0, fwidth(row));
  float scanline = 0.5 + 0.5 * cos(row * 6.28318530718);
  color *= 1.0 - 0.18 * scanline * scanlineWeight;

  // A subtle RGB phosphor mask, anchored to the output pixel grid.
  int phosphor = int(mod(floor(gl_FragCoord.x), 3.0));
  vec3 mask = vec3(0.92);
  mask[phosphor] = 1.0;
  color *= mask * 1.08;
  color *= 1.0 - 0.08 * dot(position, position);

  // Fade to black outside the curved screen instead of stretching edges.
  vec2 edge = smoothstep(vec2(0.0), fwidth(uv), uv)
            * (1.0 - smoothstep(vec2(1.0) - fwidth(uv), vec2(1.0), uv));
  return color * edge.x * edge.y;
}
