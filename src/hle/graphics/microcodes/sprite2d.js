import { toString32 } from '../../../format.js';
import { rcp16 } from '../../../rsp/rsp_recip.js';
import * as gbi from '../gbi.js';
import { GBI1 } from './gbi1.js';

// Convert reciprocal products to quarter-pixel screen coordinates. The
// reciprocal has 32 fractional bits and the input scale has 10; texture
// coordinates carry another 5 fractional bits compared with integer texels.
const TEXEL_TO_SUBPIXEL_DIVISOR = 0x100000;     // 2^(32 - 10 - 2)
const TEXCOORD_TO_SUBPIXEL_DIVISOR = 0x2000000; // 2^(32 + 5 - 10 - 2)

// The original gspSprite2D has a GBI1-style command dispatcher, but 0xBD and
// 0xBE are Draw and ScaleFlip, not PopMatrix and CullDL. Keep them scoped to
// positively identified sprite programs, including when debugging one op at a time.
export class Sprite2D extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.sprite = null;
    this.scaleX = this.scaleY = 0;
    this.flipX = this.flipY = false;
    // RSP-side mode words are initialized by the microcode's data segment.
    this.otherModeH = 0x080cff;
    this.otherModeL = 0;
    this.gbi1Commands.set(0xbd, this.executeSprite2DDraw.bind(this));
    this.gbi1Commands.set(0xbe, this.executeSprite2DScaleFlip.bind(this));
  }

  executeSetOtherModeH(cmd0, cmd1, dis) {
    this.state.rdpOtherModeH = this.otherModeH;
    super.executeSetOtherModeH(cmd0, cmd1, dis);
    this.otherModeH = this.state.rdpOtherModeH;
    this.state.rdpOtherModeL = this.otherModeL;
  }

  executeSetOtherModeL(cmd0, cmd1, dis) {
    this.state.rdpOtherModeL = this.otherModeL;
    super.executeSetOtherModeL(cmd0, cmd1, dis);
    this.otherModeL = this.state.rdpOtherModeL;
    this.state.rdpOtherModeH = this.otherModeH;
  }

  executeSprite2DBase(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    this.sprite = null;
    if (address + 24 > this.ramDV.byteLength || (cmd0 & 0xffff) !== 24) {
      this.warn('Sprite2D invalid descriptor', toString32(address));
      return;
    }
    const dv = this.ramDV;
    this.sprite = {
      image: dv.getUint32(address), palette: dv.getUint32(address + 4),
      stride: dv.getInt16(address + 8), width: dv.getInt16(address + 10),
      height: dv.getInt16(address + 12), format: dv.getUint8(address + 14),
      size: dv.getUint8(address + 15), x: dv.getInt16(address + 16), y: dv.getInt16(address + 18),
    };
    // The descriptor's final four bytes occupy the scale fields in DMEM.
    this.scaleX = dv.getInt16(address + 20);
    this.scaleY = dv.getInt16(address + 22);
    if (dis) {
      dis.text(`gsSPSprite2DBase(${toString32(address)});`);
      dis.tip(JSON.stringify(this.sprite));
    }
  }

  executeSprite2DScaleFlip(cmd0, cmd1, dis) {
    this.scaleX = cmd1 >> 16;
    this.scaleY = (cmd1 << 16) >> 16;
    this.flipX = (cmd0 & 0xff00) !== 0;
    this.flipY = (cmd0 & 0xff) !== 0;
    if (dis) {
      dis.text(`gsSPSprite2DScaleFlip(${this.scaleX}, ${this.scaleY}, ${+this.flipX}, ${+this.flipY});`);
    }
  }

  executeSprite2DDraw(cmd0, cmd1, dis) {
    const x = cmd1 >> 16, y = (cmd1 << 16) >> 16;
    if (dis) {
      dis.text(`gsSPSprite2DDraw(${x}, ${y});`);
    }
    const sp = this.sprite;
    if (!sp || sp.width <= 0 || sp.height <= 0 || sp.stride <= 0 || sp.x < 0 || sp.y < 0 ||
        sp.format > gbi.ImageFormat.G_IM_FMT_I || sp.size > gbi.ImageSize.G_IM_SIZ_32b ||
        this.scaleX <= 0 || this.scaleY <= 0) {
      this.warn('Sprite2D invalid image or scale');
      return;
    }
    const state = this.state, ti = state.textureImage;
    const load = state.tiles[7], tile = state.tiles[0];
    if (sp.format === gbi.ImageFormat.G_IM_FMT_CI) {
      const address = state.rdpSegmentAddress(sp.palette);
      const entries = sp.size === 1 ? 256 : 16;
      if (address + entries * 2 > this.ramDV.byteLength) {
        this.warn('Sprite2D palette out of bounds');
        return;
      }
      this.renderer.syncFramebufferToRAM?.(address, this.ramDV);
      ti.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, 1, address);
      load.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_4b, 0, 256, 0, 0, 0, 0, 0, 0, 0);
      load.setSize(0, 0, (entries - 1) * 4, 0);
      state.tmem.loadTLUT(ti, load);
    }
    this.otherModeH = (this.otherModeH & ~0xc000) | (sp.format === gbi.ImageFormat.G_IM_FMT_CI ? 0x8000 : 0);
    state.rdpOtherModeH = this.otherModeH;
    state.rdpOtherModeL = this.otherModeL;
    const address = state.rdpSegmentAddress(sp.image);
    this.renderer.syncFramebufferToRAM?.(address, this.ramDV);
    const loadSize = sp.size === 0 ? 1 : sp.size;
    const stride = sp.size === 0 ? Math.ceil(sp.stride / 2) : sp.stride;
    const line = Math.ceil(sp.width * (sp.size === 0 ? 0.5 : sp.size === 1 ? 1 : 2) / 8);
    ti.set(sp.format, loadSize, stride, address);
    for (const strip of sprite2DStrips(sp, this.scaleX, this.scaleY, this.flipX, this.flipY, x, y)) {
      const { sourceY, lastY, x0, y0, x1, y1, s, t } = strip;
      const left = sp.x * (sp.size === 0 ? 2 : 4);
      const right = (sp.x + sp.width - 1) * (sp.size === 0 ? 2 : 4);
      const lastByte = address + (lastY * stride + Math.floor(right / 4)) * (1 << loadSize) / 2 + 8;
      if (sourceY < 0 || lastY > 1023 || lastByte > this.ramDV.byteLength) {
        this.warn('Sprite2D image out of bounds');
        return;
      }
      load.set(sp.format, loadSize, line, 0, 0, gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
      load.setSize(left, sourceY * 4, right, lastY * 4);
      state.tmem.loadTile(ti, load);
      tile.set(sp.format, sp.size, line, 0, 0, gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
      tile.setSize(0, 0, (sp.width - 1) * 4, (lastY - sourceY) * 4);
      const copy = state.getCycleType() === gbi.CycleType.G_CYC_COPY;
      const inclusive = copy || state.getCycleType() === gbi.CycleType.G_CYC_FILL;
      const rightX = x1 / 4 + (inclusive ? 1 : 0), bottomY = y1 / 4 + (inclusive ? 1 : 0);
      const ds = (this.flipX ? -1 : 1) * this.scaleX / (copy ? 4096 : 1024);
      const dt = (this.flipY ? -1 : 1) * this.scaleY / 1024;
      // RDP S/T are signed 10.5. Fractional Y positions can start before row 0.
      this.renderer.texRect(0, x0 / 4, y0 / 4, rightX, bottomY, s / 32, t / 32,
        s / 32 + (rightX - x0 / 4) * ds, t / 32 + (bottomY - y0 / 4) * dt, false);
    }
  }
}

// Sprite2D refines the RSP reciprocal once with r * (2 - x*r). Preserve the
// intermediate truncation; floating point division alone changes strip edges.
function reciprocal(value) {
  const r = rcp16(value) * 2;
  return Math.floor(r * (0x20000 - Math.floor(r * value / 0x10000)) / 0x10000);
}

// Screen coordinates are quarter pixels, texture coordinates are 1/32 texels.
// Each strip fits TMEM, retaining a row for filtering when scaling. The Y-flip
// path walks the source backwards while destination rectangles still go down.
function* sprite2DStrips(sp, scaleX, scaleY, flipX, flipY, x, y) {
  const invX = reciprocal(scaleX), invY = reciprocal(scaleY);
  const width = Math.floor(invX * sp.width / TEXEL_TO_SUBPIXEL_DIVISOR);
  const x1 = Math.min(4095, x + width), x0 = Math.max(0, x);
  if (x1 <= x0) {
    return;
  }
  const s = ((sp.size === 0 ? sp.x & 1 : 0) + (flipX ? sp.width - 1 : 0)) * 32 -
    (x < 0 ? Math.floor(x * scaleX * (flipX ? -1 : 1) / 128) : 0);
  const bits = sp.size === 0 ? sp.width * 4 + (sp.width & 1) * 4 + ((sp.x + sp.width) & 1) * 4 :
    sp.width * (sp.size === 1 ? 8 : 16);
  const line = Math.ceil(bits / 64);
  const capacity = sp.format === gbi.ImageFormat.G_IM_FMT_CI || sp.size === 3 ? 256 : 512;
  const rows = Math.floor(reciprocal(line) * capacity / 0x100000000);
  if (rows < 2) {
    return;
  }
  let nextY = y, sourceY = sp.y, fraction = 0, flippedFraction = 0;
  if (flipY) {
    const subpixel = y & 3;
    fraction = -(subpixel * scaleY >> 6) + (subpixel ? (subpixel - 2) * 16 : 0);
    const zero = fraction === 0;
    if (zero) {
      fraction = -32;
    }
    flippedFraction = -subpixel * scaleY >> 7;
    sourceY += sp.height - 1 + (zero ? 1 : 0) + (subpixel ? 1 : 0) + (zero && scaleY !== 1024 ? 1 : 0);
  }
  let done = false;
  // Bound malformed inputs independently of the outer display-list budget.
  for (let strip = 0; !done && strip < 4096; strip++) {
    let y0 = nextY;
    if (y0 >= 4094) {
      return;
    }
    const subpixel = y0 & 3;
    let startT;
    if (flipY) {
      startT = (rows - ((flippedFraction & 31) ? 1 : 0)) * 32 + fraction;
      if (startT > (rows - 1) * 32) {
        startT -= 32;
      }
    } else {
      startT = fraction & 31;
    }
    let t = startT + Math.floor(subpixel * scaleY / 128) * (flipY ? 1 : -1);
    const available = flipY ? t + 1 : (rows - 1) * 32 - startT;
    nextY = Math.floor((y0 + Math.floor(invY * available / TEXCOORD_TO_SUBPIXEL_DIVISOR) + 4) / 4) * 4;
    if (nextY >= 4095 || nextY <= y0) {
      return;
    }
    let lastY;
    if (flipY) {
      flippedFraction = Math.floor(((y0 - subpixel) - nextY) * scaleY / 128) + t;
      lastY = sourceY;
      if (((fraction | subpixel) & 31) === 0 || ((fraction & 31) === 0 && scaleY !== 1024)) {
        lastY--;
      }
      sourceY = lastY + 1 - rows;
      fraction = flippedFraction;
      if (sourceY <= sp.y) {
        t -= (sp.y - sourceY) * 32;
        nextY = y0 + Math.floor(invY * t / TEXCOORD_TO_SUBPIXEL_DIVISOR) + (scaleY === 1024 ? 4 : 0);
        done = true;
        sourceY = sp.y;
      }
    } else {
      sourceY += fraction >>> 5;
      lastY = sourceY + rows - 1;
      fraction = Math.floor(scaleY * (nextY - y0) / 128) + startT;
      if ((fraction >>> 5) + sourceY - sp.y >= sp.height) {
        lastY = sp.y + sp.height - (subpixel === 0 && scaleY >= 1024 ? 1 : 0);
        nextY = y + Math.floor(invY * sp.height / TEXEL_TO_SUBPIXEL_DIVISOR);
        done = true;
      }
    }
    if (nextY < 0) {
      continue;
    }
    if (y0 < 0) {
      t += Math.floor(-y0 * scaleY / 128) * (flipY ? -1 : 1);
      y0 = 0;
    }
    if (nextY > y0) {
      yield { sourceY, lastY, x0, y0, x1, y1: nextY, s, t };
    }
  }
}
