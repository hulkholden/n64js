export class Tile {
  constructor() {
    this.format = -1;
    this.size = 0;
    this.line = 0;
    this.tmem = 0;
    this.palette = 0;
    this.cm_t = 0;
    this.mask_t = 0;
    this.shift_t = 0;
    this.cm_s = 0;
    this.mask_s = 0;
    this.shift_s = 0;
    this.uls = 0;
    this.ult = 0;
    this.lrs = 0;
    this.lrt = 0;

    // Last computed hash for this Tile. 0 if invalid/not calculated.
    // Invalidated on any load, settile, settilesize.
    this.hash = 0;
  }

  get left() {
    return this.uls / 4;
  }

  get top() {
    return this.ult / 4;
  }

  get right() {
    return this.lrs / 4;
  }

  get bottom() {
    return this.lrt / 4;
  }

  get width() {
    return getTextureDimension(this.uls, this.lrs, this.mask_s);
  }

  get height() {
    return getTextureDimension(this.ult, this.lrt, this.mask_t);
  }
}

function getTextureDimension(ul, lr, mask) {
  var dim = ((lr - ul) / 4) + 1;
  return mask ? Math.min(1 << mask, dim) : dim;
}
