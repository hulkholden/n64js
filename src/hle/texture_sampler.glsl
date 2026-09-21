// Included after the varying declarations in the generated fragment shader.
// The sampler operates on decoded RGBA textures, not raw TMEM.
// Integer N64 coordinates name texel centres; there is no WebGL half-texel bias.
// See https://github.com/Themaister/parallel-rdp/blob/master/parallel-rdp/shaders/texture.h
// for the RDP's shift/clamp/mask order and 5-bit, three-point filter behaviour.
// Rectangle start coordinates and native pixel increments are described in
// https://ultra64.ca/files/documentation/online-manuals/man/pro-man/pro14/14-01.html

struct TextureTile {
  // xy: tile high boundary relative to its origin; zw: integer clamp texel.
  highp vec4 bounds;
  highp ivec2 mask;
  highp ivec2 mode;
  bool enabled;
};
uniform TextureTile uTile0;
uniform TextureTile uTile1;
uniform int uTextureFilter;
uniform bool uTextureRectEnabled;
uniform highp vec4 uTextureRectScreen;
uniform highp vec4 uTextureRectOrigin;
uniform highp vec4 uTextureRectDerivatives;

highp vec2 textureCoordinates() {
  if (!uTextureRectEnabled) return vUV;
  // RDP rectangles evaluate S/T at native integer screen coordinates, starting
  // at the command's S/T, not at WebGL pixel centres. Keep that sample grid
  // when upscaling: extra fractional samples can wrap into an unrelated row
  // at the end of a texture strip (e.g. Mario Kart's menu images).
  highp vec2 pixel = floor(gl_FragCoord.xy * uTextureRectScreen.xy + uTextureRectScreen.zw);
  highp vec2 delta = pixel - uTextureRectOrigin.xy;
  return uTextureRectOrigin.zw + delta.x * uTextureRectDerivatives.xy +
                                 delta.y * uTextureRectDerivatives.zw;
}

highp float clampTextureCoord(highp float coord, highp float high,
                             highp float last, int mode) {
  if ((mode & 2) == 0) return coord;
  return coord >= high ? last : max(coord, 0.0);
}

highp int maskTextureCoord(highp int coord, highp int mask, highp int mode) {
  if (mask == 0) return coord;
  highp int period = 1 << min(mask, 10);
  if ((mode & 1) != 0 && (coord & period) != 0) coord = ~coord;
  return coord & (period - 1);
}

highp vec4 fetchTextureTexel(sampler2D tex, highp ivec2 coord, TextureTile tile) {
  coord = ivec2(maskTextureCoord(coord.x, tile.mask.x, tile.mode.x),
                maskTextureCoord(coord.y, tile.mask.y, tile.mode.y));
  // Wrapping axes expose their full mask period. Unmasked addresses outside the
  // decoded image still replicate its edge until we expose all of TMEM.
  coord = clamp(coord, ivec2(0), textureSize(tex, 0) - 1);
  return floor(texelFetch(tex, coord, 0) * 255.0 + 0.5);
}

vec4 sampleN64Texture(sampler2D tex, highp vec2 uv, highp vec2 scale,
                      highp vec2 offset, TextureTile tile) {
  if (!tile.enabled) return vec4(0.0, 0.0, 0.0, 1.0);
  // Shift before subtracting the tile origin, then retain 5 fractional bits.
  highp vec2 coord = floor((uv * scale - offset) * 32.0) / 32.0;
  coord = vec2(clampTextureCoord(coord.x, tile.bounds.x, tile.bounds.z, tile.mode.x),
               clampTextureCoord(coord.y, tile.bounds.y, tile.bounds.w, tile.mode.y));
  highp ivec2 base = ivec2(floor(coord));
  if (uTextureFilter < 2) return fetchTextureTexel(tex, base, tile) / 255.0;

  highp vec2 weight = fract(coord) * 32.0;
  highp vec4 c10 = fetchTextureTexel(tex, base + ivec2(1, 0), tile);
  highp vec4 c01 = fetchTextureTexel(tex, base + ivec2(0, 1), tile);
  highp vec4 color;
  // G_TF_AVERAGE adds a four-texel average at the exact midpoint. Away from
  // the midpoint it uses the same three-point filter as G_TF_BILERP.
  if (uTextureFilter == 3 && all(equal(weight, vec2(16.0)))) {
    color = (fetchTextureTexel(tex, base, tile) + c10 + c01 +
             fetchTextureTexel(tex, base + ivec2(1), tile)) / 4.0;
  } else if (weight.x + weight.y < 32.0) {
    highp vec4 c00 = fetchTextureTexel(tex, base, tile);
    color = c00 + ((c10 - c00) * weight.x + (c01 - c00) * weight.y) / 32.0;
  } else {
    highp vec4 c11 = fetchTextureTexel(tex, base + ivec2(1), tile);
    color = c11 + ((c01 - c11) * (32.0 - weight.x) +
                   (c10 - c11) * (32.0 - weight.y)) / 32.0;
  }
  return floor(color + 0.5) / 255.0;
}
