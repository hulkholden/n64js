import * as gbi from './gbi.js';

// TLUT also applies to 4/8-bit RGBA, IA and I (e.g. Extreme-G and Bio FREAKS).
// Preserve the CI fallback when TLUT is off; other formats follow its enable state.
export function getTexturePaletteFormat(tile, tlutFormat) {
  if (tile.size !== gbi.ImageSize.G_IM_SIZ_4b && tile.size !== gbi.ImageSize.G_IM_SIZ_8b) {
    return gbi.TextureLUT.G_TT_NONE;
  }
  if (tile.format === gbi.ImageFormat.G_IM_FMT_CI) {
    return tlutFormat === gbi.TextureLUT.G_TT_IA16 ? tlutFormat : gbi.TextureLUT.G_TT_RGBA16;
  }
  const supported = tile.format === gbi.ImageFormat.G_IM_FMT_RGBA ||
    tile.format === gbi.ImageFormat.G_IM_FMT_IA || tile.format === gbi.ImageFormat.G_IM_FMT_I;
  const enabled = tlutFormat === gbi.TextureLUT.G_TT_RGBA16 || tlutFormat === gbi.TextureLUT.G_TT_IA16;
  return supported && enabled ? tlutFormat : gbi.TextureLUT.G_TT_NONE;
}

// Expand five-bit channels by replicating their high bits.
export function convertRGBA16Pixel(value) {
  const expand = v => (v << 3) | (v >>> 2);
  return (expand((value >>> 11) & 31) << 24) | (expand((value >>> 6) & 31) << 16) |
    (expand((value >>> 1) & 31) << 8) | ((value & 1) ? 255 : 0);
}
