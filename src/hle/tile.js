export class Tile {
  constructor() {
    this.format = -1;
    this.size = 0;
    this.line = 0;
    this.tmem = 0;
    this.palette = 0;
    this.cmT = 0;
    this.maskT = 0;
    this.shiftT = 0;
    this.cmS = 0;
    this.maskS = 0;
    this.shiftS = 0;
    this.uls = 0;
    this.ult = 0;
    this.lrs = 0;
    this.lrt = 0;

    // Last computed hash for this Tile. 0 if invalid/not calculated.
    // Invalidated on any load, settile, settilesize.
    this.hash = 0;
  }

  get left() { return this.uls / 4; }
  get top() { return this.ult / 4; }
  get right() { return this.lrs / 4; }
  get bottom() { return this.lrt / 4; }

  // Return the dimensions before applying maskS/maskT.
  get unmaskedWidth() { return calcTileDimension(this.lrs, this.uls); }
  get unmaskedHeight() { return calcTileDimension(this.lrt, this.ult); }

  // Return the dimensions after applying maskS/maskT.
  get width() { return getTextureDimension(this.unmaskedWidth, this.maskS); }
  get height() { return getTextureDimension(this.unmaskedHeight, this.maskT); }

  set(format, size, line, tmem, palette, cmS, maskS, shiftS, cmT, maskT, shiftT) {
    this.format = format;
    this.size = size;
    this.line = line;
    this.tmem = tmem;
    this.palette = palette;
    this.cmS = cmS;
    this.maskS = maskS;
    this.shiftS = shiftS;
    this.cmT = cmT;
    this.maskT = maskT;
    this.shiftT = shiftT;
    this.hash = 0;
  }

  setSize(uls, ult, lrs, lrt) {
    this.uls = uls;
    this.ult = ult;
    this.lrs = lrs;
    this.lrt = lrt;
    this.hash = 0;
  }
}

export function calcTileDimension(lr, ul) {
  // TODO: confirm if the limit is 0x3ff or 0xfff.
  // 1024 pixels seems more plausible than 4096.
  return ((lr >>> 2) - (ul >>> 2) + 1) & 0x3ff;
}

function getTextureDimension(dim, mask) {
  return mask ? Math.min(1 << mask, dim) : dim;
}
