import { G_TX_CLAMP } from './gbi.js';

// Tile bounds control clamping, not the extent of a wrapping texture in TMEM.
// In particular, scrolling the origin must not truncate the decoded image.
export function textureDecodeTile(tile, copy = false) {
  const extent = (size, mask, mode) => mask && (copy || !(mode & G_TX_CLAMP)) ? 1 << Math.min(mask, 10) : size;
  const width = extent(tile.width, tile.maskS, tile.cmS);
  const height = extent(tile.height, tile.maskT, tile.cmT);
  if (width === tile.width && height === tile.height) return tile;
  // Use a separate view: the original bounds are still needed by the shader,
  // and a hash cached for the smaller image cannot cover newly exposed rows.
  return { ...tile, width, height, hash: 0 };
}
