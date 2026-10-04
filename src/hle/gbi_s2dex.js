import { RDPCommands, GBIRDPCommands } from '../lle/rdp_commands.js';
import { toString16, toString32 } from "../format";
import * as gbi from './gbi.js';
import * as s2dex1 from './s2dex1_constants.js';
import * as s2dex2 from './s2dex2_constants.js';
import { GBI1 } from "./gbi1";
import { GBI2 } from "./gbi2";

// Where do these fit in?
// const ucodeSprite2d = {
//   0xbe: executeSprite2dScaleFlip,
//   0xbd: executeSprite2dDraw
// };

// Preserve the existing exports using the shared RDP command definitions.
export const {
  FillTriangle,
  FillZBufferTriangle,
  TextureTriangle,
  TextureZBufferTriangle,
  ShadeTriangle,
  ShadeZBufferTriangle,
  ShadeTextureTriangle,
  ShadeTextureZBufferTriangle,
  TextureRectangle,
  TextureRectangleFlip,
  SyncLoad,
  SyncPipe,
  SyncTile,
  SyncFull,
  SetKeyGB,
  SetKeyR,
  SetConvert,
  SetScissor,
  SetPrimDepth,
  SetOtherModes,
  LoadTLut: LoadTLUT,
  SetTileSize,
  LoadBlock,
  LoadTile,
  SetTile,
  FillRectangle,
  SetFillColor,
  SetFogColor,
  SetBlendColor,
  SetPrimColor,
  SetEnvColor,
  SetCombine,
  SetTextureImage,
  SetMaskImage,
  SetColorImage,
} = RDPCommands;

const G_OBJ_MTX = 0;
const G_OBJ_SUBMTX = 2;
const G_OBJ_FLAG_FLIPS = 0x01;
const G_OBJ_FLAG_FLIPT = 0x10;

const kRenderNone = 0;
const kRenderFullTransform = 1;
const kRenderPartialTransform = 2;
const kRenderNoRotation = 3;
const kBgLoadBlock = 0x0033;
const kBgLoadTile = 0xfff4;

class ObjBg {
  constructor() {
    this.imageX = 0;
    this.imageW = 0;
    this.frameX = 0;
    this.frameW = 0;

    this.imageY = 0;
    this.imageH = 0;
    this.frameY = 0;
    this.frameH = 0;

    this.imagePtr = 0;
    this.imageLoad = 0;
    this.imageFmt = 0;
    this.imageSiz = 0;
    this.imagePal = 0;
    this.imageFlip = 0;
    this.tmemW = 0;
    this.tmemH = 0;
    this.tmemLoadSH = 0;
    this.tmemLoadTH = 0;
    this.tmemSizeW = 0;
    this.tmemSize = 0;
  }

  load(dv, offset) {
    this.imageX = dv.getUint16(offset + 0, false) / 32;
    this.imageW = dv.getUint16(offset + 2, false) / 4;
    this.frameX = dv.getInt16(offset + 4, false) / 4;
    this.frameW = dv.getUint16(offset + 6, false) / 4;

    this.imageY = dv.getUint16(offset + 8, false) / 32;
    this.imageH = dv.getUint16(offset + 10, false) / 4;
    this.frameY = dv.getInt16(offset + 12, false) / 4;
    this.frameH = dv.getUint16(offset + 14, false) / 4;

    this.imagePtr = dv.getUint32(offset + 16, false);
    this.imageLoad = dv.getUint16(offset + 20, false);
    this.imageFmt = dv.getUint8(offset + 22, false);
    this.imageSiz = dv.getUint8(offset + 23, false);
    this.imagePal = dv.getUint16(offset + 24, false);
    this.imageFlip = dv.getUint16(offset + 26, false);

    this.tmemW = dv.getUint16(offset + 28, false);
    this.tmemH = dv.getUint16(offset + 30, false);
    this.tmemLoadSH = dv.getUint16(offset + 32, false);
    this.tmemLoadTH = dv.getUint16(offset + 34, false);
    this.tmemSizeW = dv.getUint16(offset + 36, false);
    this.tmemSize = dv.getUint16(offset + 38, false);
  }

  toString() {
    return `imageX/Y = (${this.imageX}, ${this.imageY}), imageW/H = (${this.imageW}, ${this.imageH})
frameX/Y = (${this.frameX}, ${this.frameY}), frameW/H = (${this.frameW}, ${this.frameH})
imagePtr = ${toString32(this.imagePtr)}, imageLoad = ${this.imageLoad}
imageFmt = ${gbi.ImageFormat.nameOf(this.imageFmt)}, imageSiz = ${gbi.ImageSize.nameOf(this.imageSiz)}
imagePal = ${this.imagePal}, imageFlip = ${this.imageFlip}`;
  }
}

class ObjScaleBg extends ObjBg {
  load(dv, offset) {
    super.load(dv, offset);
    this.scaleW = dv.getUint16(offset + 28, false) / 1024;
    this.scaleH = dv.getUint16(offset + 30, false) / 1024;
    this.imageYorig = dv.getInt32(offset + 32, false) / 32;
  }

  toString() {
    return `${super.toString()}\nscaleW/H = (${this.scaleW}, ${this.scaleH}), imageYorig = ${this.imageYorig}`;
  }
}

class ObjMatrix {
  constructor() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;

    this.x = 0;
    this.y = 0;

    this.sx = 1;
    this.sy = 1;
  }

  loadFullMatrix(dv, offset) {
    this.a = dv.getInt32(offset + 0, false) / 65536;
    this.b = dv.getInt32(offset + 4, false) / 65536;
    this.c = dv.getInt32(offset + 8, false) / 65536;
    this.d = dv.getInt32(offset + 12, false) / 65536;
    this.loadSubMatrix(dv, offset + 16);
  }

  loadSubMatrix(dv, offset) {
    this.x = dv.getInt16(offset + 0, false) / 4;
    this.y = dv.getInt16(offset + 2, false) / 4;

    this.sx = dv.getUint16(offset + 4, false) / 1024;
    this.sy = dv.getUint16(offset + 6, false) / 1024;
  }

  toString() {
    return `rot = (${this.a}, ${this.b}, ${this.c}, ${this.d}), trans = (${this.x}, ${this.y}), scale = (${this.sx}, ${this.sy})`;
  }
}

class ObjSprite {
  constructor() {
    this.objX = 0;
    this.scaleW = 0;
    this.imageW = 0;

    this.objY = 0;
    this.scaleH = 0;
    this.imageH = 0;

    this.imageStride = 0;
    this.imageAdrs = 0;
    this.imageFmt = 0;
    this.imageSiz = 0;
    this.imagePal = 0;
    this.imageFlags = 0;
  }

  load(dv, offset) {
    this.objX = dv.getInt16(offset + 0, false) / 4;
    this.scaleW = dv.getUint16(offset + 2, false) / 1024;
    this.imageW = dv.getUint16(offset + 4, false) / 32;
    // 2 bytes of padding
    this.objY = dv.getInt16(offset + 8, false) / 4;
    this.scaleH = dv.getUint16(offset + 10, false) / 1024;
    this.imageH = dv.getUint16(offset + 12, false) / 32;
    // 2 bytes of padding
    this.imageStride = dv.getUint16(offset + 16, false);
    this.imageAdrs = dv.getUint16(offset + 18, false);
    this.imageFmt = dv.getUint8(offset + 20, false);
    this.imageSiz = dv.getUint8(offset + 21, false);
    this.imagePal = dv.getUint8(offset + 22, false);
    this.imageFlags = dv.getUint8(offset + 23, false);
  }

  get objW() { return this.imageW / this.scaleW; }
  get objH() { return this.imageH / this.scaleH; }

  toString() {
    return `pos = (${this.objX}, ${this.objY}), scale = (${this.scaleW}, ${this.scaleH}), image = (${this.imageW}, ${this.imageH})
stride = ${this.imageStride}, address = ${toString16(this.imageAdrs)}, format = ${gbi.ImageFormat.nameOf(this.imageFmt)}, size = ${gbi.ImageSize.nameOf(this.imageSiz)}
paletteIdx = ${this.imagePal}, flags = ${this.imageFlags}`
  }
}

class ObjTexture {
  constructor() {
    this.type = 0;
    this.image = 0;

    this.tileTMEM = 0;
    this.texLoadSize = 0;
    this.texLoadRows = 0;

    this.sid = 0;
    this.flag = 0;
    this.mask = 0;
  }

  load(dv, offset) {
    this.type = dv.getUint32(offset + 0, false);
    this.image = dv.getUint32(offset + 4, false);

    // Value assigned to Tile tmem parameter.
    this.tileTMEM = dv.getUint16(offset + 8, false);
    // Value assigned to TextureImage width and lrs argument of load commands.
    this.texLoadSize = dv.getUint16(offset + 10, false);
    // Value assigned to lrt argument of loads commands.
    this.texLoadRows = dv.getUint16(offset + 12, false);

    this.sid = dv.getUint16(offset + 14, false);
    this.flag = dv.getUint32(offset + 16, false);
    this.mask = dv.getUint32(offset + 20, false);
  }

  toString() {
    let text = `type = ${toString32(this.type)}, image = ${toString32(this.image)}\n`;
    text += `tmem = ${toString16(this.tileTMEM)}, size (qwords) = ${toString16(this.texLoadSize)}, rows (texels) = ${this.texLoadRows}`;
    return text;
  }
}

function getBgTextureLayout(bg) {
  const bytesPerPixel = (4 << bg.imageSiz) / 8;
  const splitBanks = bg.imageSiz === gbi.ImageSize.G_IM_SIZ_32b || bg.imageFmt === gbi.ImageFormat.G_IM_FMT_YUV;
  const bankBytes = splitBanks ? bytesPerPixel / 2 : bytesPerPixel;
  const capacity = splitBanks || bg.imageFmt === gbi.ImageFormat.G_IM_FMT_CI ? 2048 : 4096;
  const alignment = 8 / bankBytes;

  // Ordinary formats load as 16-bit words, including CI4/I4: native 4-bit
  // RDP loads do not transfer data. Split-bank formats need their own routing.
  const loadSize = splitBanks ? bg.imageSiz : gbi.ImageSize.G_IM_SIZ_16b;
  const loadFormat = splitBanks ? bg.imageFmt : gbi.ImageFormat.G_IM_FMT_RGBA;
  const loadPixels = bytesPerPixel / ((4 << loadSize) / 8);
  return { bytesPerPixel, bankBytes, capacity, alignment, loadSize, loadFormat, loadPixels };
}

function getBg1cycFrame(bg, scissor) {
  const imageW = Math.floor(bg.imageW);
  const imageH = Math.floor(bg.imageH);
  if (!imageW || !imageH || !bg.scaleW || !bg.scaleH) {
    return null;
  }
  const flip = (bg.imageFlip & 1) !== 0;
  // S2DEX reserves the image's last quarter-pixel before rounding the
  // maximum frame down to whole pixels. A flipped frame shrinks on the left.
  const frameW = Math.min(bg.frameW, Math.floor(imageW / bg.scaleW - 0.25));
  const frameH = Math.min(bg.frameH, Math.floor(imageH / bg.scaleH - 0.25));
  const frameX = bg.frameX + (flip ? bg.frameW - frameW : 0);
  const left = Math.max(frameX, scissor.x0);
  const top = Math.max(bg.frameY, scissor.y0);
  const right = Math.min(frameX + frameW, scissor.x1);
  const bottom = Math.min(bg.frameY + frameH, scissor.y1);
  // Vertical motion/coverage is integral; horizontal coordinates retain
  // quarter-pixels. Texture coordinates have five fractional bits.
  const x0 = Math.ceil(left), x1 = Math.ceil(right);
  const y0 = Math.floor(top), y1 = y0 + Math.floor(bottom - top);
  if (x0 >= x1 || y0 >= y1) {
    return null;
  }
  const clippedX = flip ? frameX + frameW - right : left - frameX;
  const imageX = bg.imageX + Math.floor(clippedX * bg.scaleW * 32) / 32;
  const sourceY = bg.imageY + Math.floor((top - bg.frameY) * bg.scaleH * 32) / 32;
  const step = flip ? -bg.scaleW : bg.scaleW;
  const scaledWidth = Math.floor((right - left) * bg.scaleW * 32) / 32;
  const sourceX = imageX + (flip ? scaledWidth - 1 : 0) + (x0 - left) * step;
  return { x0, y0, x1, y1, sourceX, sourceY, step };
}

function getBg1cycStripPlan(bg, frame, layout, filtered) {
  const { capacity, bankBytes, alignment } = layout;
  const imageW = Math.floor(bg.imageW);
  // Plan from the unclipped frame so scissoring cannot change the vertical
  // sampling phase. One extra word covers a misaligned start; filtering
  // needs an extra column and row. Very wide images also split horizontally.
  const maxWidth = Math.floor(Math.min(1023, capacity / bankBytes / (1 + filtered)) / alignment) * alignment;
  const span = Math.min(Math.floor(bg.frameW * bg.scaleW * 32) / 32 + filtered, imageW);
  const tileWidth = Math.min(maxWidth, (Math.ceil(span / alignment) + 1) * alignment);
  const rows = Math.min(512, Math.floor(capacity / (tileWidth * bankBytes))) - filtered;

  // imageYorig anchors the strip boundaries, not just the source address.
  // The microcode quantizes strip heights to 10 fractional screen bits and
  // restarts T at each strip. Keep that phase when scrolling or clipping.
  // References: S2DEX manual 4.1.3 and guS2DEmuBgRect1Cyc:
  // https://ultra64.ca/files/documentation/online-manuals/man-v5-1/ucode/s2dex/04.htm
  // https://github.com/decompals/ultralib/blob/main/src/gu/us2dex_emu.c
  const stripHeight = Math.floor(rows * 1024 / bg.scaleH);
  const scroll = Math.floor((frame.sourceY - bg.imageYorig) / bg.scaleH);
  const screenOrigin = frame.y0 - scroll;
  return { tileWidth, rows, stripHeight, screenOrigin };
}

export class S2DEXCommon {
  constructor(state, ramDV, gbi) {
    this.state = state;
    this.ramDV = ramDV;
    this.gbi = gbi;

    // Helper instances to avoid reallocation when rendering.
    this.bg = new ObjBg();
    this.scaleBg = new ObjScaleBg();
    this.matrix = new ObjMatrix();
    this.sprite = new ObjSprite();
    this.texture = new ObjTexture();
  }

  executeBg1cyc(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    this.scaleBg.load(this.ramDV, address);

    this.renderBg1cyc();
    if (dis) {
      dis.text(`gSPBgRect1Cyc(${toString32(address)});`);
      dis.tip(this.scaleBg.toString());
    }
  }

  executeBgCopy(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    this.bg.load(this.ramDV, address);
    this.renderBgCopy();
    if (dis) {
      dis.text(`gSPBgRectCopy(${toString32(address)});`);
      dis.tip(this.bg.toString());
    }
  }

  renderBg1cyc() {
    const bg = this.scaleBg;
    if (bg.imageSiz > gbi.ImageSize.G_IM_SIZ_32b || bg.imageFmt > gbi.ImageFormat.G_IM_FMT_I) {
      this.gbi.warn('gSPBgRect1Cyc: invalid background format or size');
      return;
    }
    const state = this.state;
    const renderer = this.gbi.renderer;
    const frame = getBg1cycFrame(bg, state.scissor);
    if (!frame) {
      return;
    }
    const { x0, y0, x1, y1, sourceX, step } = frame;
    const imageW = Math.floor(bg.imageW);
    const imageH = Math.floor(bg.imageH);
    const filtered = state.getTextureFilterType() === gbi.TextureFilter.G_TF_POINT ? 0 : 1;
    const layout = getBgTextureLayout(bg);
    const { bytesPerPixel, bankBytes, alignment, loadSize, loadFormat, loadPixels } = layout;
    // The microcode rounds source strides down to whole RDRAM words. Photopie
    // uses imageW=257 for a 256-byte CI8 row to retain a 256-pixel frame.
    const stride = Math.floor(imageW * bytesPerPixel / 8) * 8;
    if (!stride) {
      return;
    }

    const { tileWidth, rows, stripHeight, screenOrigin } = getBg1cycStripPlan(bg, frame, layout, filtered);
    const imageAddress = state.rdpSegmentAddress(bg.imagePtr);
    renderer.syncFramebufferToRAM?.(imageAddress, this.ramDV);
    const loadTile = state.tiles[gbi.G_TX_LOADTILE], renderTile = state.tiles[0];
    const ti = state.textureImage;

    for (let y = y0; y < y1;) {
      // Jump over strips too short to cover a screen row during reduction.
      const strip = Math.floor(((y - screenOrigin + 1) * 1024 - 1) / stripHeight);
      const stripY = screenOrigin + Math.floor(strip * stripHeight / 1024);
      const endY = Math.min(y1, screenOrigin + Math.floor((strip + 1) * stripHeight / 1024));
      const t = Math.floor((y - stripY) * bg.scaleH * 32) / 32;
      const sourceY = Math.floor(bg.imageYorig) + strip * rows + Math.floor(t);
      const t0 = t - Math.floor(t);
      const loadHeight = Math.floor(t0 + (endY - y - 1) * bg.scaleH) + 1 + filtered;

      for (let x = x0; x < x1;) {
        const width = Math.min(x1 - x, Math.max(1, Math.floor((tileWidth - alignment - filtered) / bg.scaleW)));
        const s = sourceX + (x - x0) * step;
        const lastS = s + (width - 1) * step;
        const sourceLeft = Math.floor(Math.min(s, lastS) / alignment) * alignment;
        const loadWidth = Math.ceil((Math.floor(Math.max(s, lastS)) + 1 + filtered - sourceLeft) / alignment) * alignment;
        const line = loadWidth * bankBytes / 8;
        ti.set(loadFormat, loadSize, stride / ((4 << loadSize) / 8), imageAddress);
        loadTile.set(loadFormat, loadSize, line, 0, 0, 0, 0, 0, 0, 0, 0);
        loadTile.setSize(0, 0, (loadWidth * loadPixels - 1) * 4, (loadHeight - 1) * 4);
        // 1-cycle backgrounds always use rectangular transfers. imageLoad is
        // only a copy-mode hint. Wrap the *linear* source, including the filter
        // neighbours, so crossing the right edge advances to the next row.
        state.tmem.loadBackground(ti, loadTile, sourceLeft * bytesPerPixel,
          sourceY, stride, imageH, loadWidth * loadPixels, loadHeight);
        state.invalidateTileHashes();
        renderTile.set(bg.imageFmt, bg.imageSiz, line, 0, bg.imagePal,
          gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
        renderTile.setSize(0, 0, (loadWidth - 1) * 4, (loadHeight - 1) * 4);
        const s0 = s - sourceLeft;
        renderer.texRect(0, x, y, x + width, endY, s0, t0,
          s0 + width * step, t0 + (endY - y) * bg.scaleH, false);
        x += width;
      }
      y = endY;
    }
  }

  renderBgCopy() {
    const bg = this.bg;
    if (bg.imageSiz > gbi.ImageSize.G_IM_SIZ_32b || bg.imageFmt > gbi.ImageFormat.G_IM_FMT_I ||
        (bg.imageLoad !== kBgLoadBlock && bg.imageLoad !== kBgLoadTile)) {
      this.gbi.warn('gSPBgRectCopy: invalid background format, size or load type');
      return;
    }
    const state = this.state;
    const renderer = this.gbi.renderer;
    const imageW = Math.floor(bg.imageW), imageH = Math.floor(bg.imageH);
    const frameX = Math.floor(bg.frameX), frameY = Math.floor(bg.frameY);
    const frameW = Math.floor(bg.frameW), frameH = Math.floor(bg.frameH);
    const x0 = Math.max(frameX, Math.ceil(state.scissor.x0));
    const y0 = Math.max(frameY, Math.ceil(state.scissor.y0));
    const x1 = Math.min(frameX + frameW, Math.ceil(state.scissor.x1));
    const y1 = Math.min(frameY + frameH, Math.ceil(state.scissor.y1));
    if (imageW <= 0 || imageH <= 0 || x0 >= x1 || y0 >= y1) {
      return;
    }

    // S2DEX copy backgrounds have integer coordinates and a horizontal flip.
    // The source is a circular *linear* image: crossing its right edge also
    // advances Y. See the S2DEX manual, section 4.1.2 (gSPBgRectCopy).
    const flip = (bg.imageFlip & 1) !== 0;
    const step = flip ? -1 : 1;
    const sourceX = Math.floor(bg.imageX) + (flip ? frameW - 1 - (x0 - frameX) : x0 - frameX);
    const sourceY = Math.floor(bg.imageY) + y0 - frameY;
    const { bytesPerPixel, bankBytes, capacity, alignment, loadSize, loadFormat, loadPixels } = getBgTextureLayout(bg);
    const imageAddress = state.rdpSegmentAddress(bg.imagePtr);
    // Make backgrounds sourced from an earlier render target visible to TMEM.
    renderer.syncFramebufferToRAM?.(imageAddress, this.ramDV);

    const loadTile = state.tiles[gbi.G_TX_LOADTILE];
    const renderTile = state.tiles[0];
    const ti = state.textureImage;

    // LoadBlock transfers whole source rows. Limit the number of rows so
    // rounding DXT cannot change parity before the end of a row. Unsupported
    // block widths fall back to the equivalent rectangular transfer.
    const words = imageW * bytesPerPixel / 8;
    const dxt = Math.ceil(2048 / words);
    const carry = words * dxt - 2048;
    const blockRows = carry > 0 ? Math.floor((dxt - 1) / carry) : Infinity;
    const block = bg.imageLoad === kBgLoadBlock && imageW <= 512 && imageW % alignment === 0 && blockRows > 0;

    // The descriptor's guS2DInitBg fields describe the microcode's original
    // strips. Recompute transfer sizes for the clipped HLE rectangles instead.
    for (let x = x0; x < x1;) {
      const linearX = sourceX + step * (x - x0);
      const sx = ((linearX % imageW) + imageW) % imageW;
      const rowCarry = Math.floor(linearX / imageW);
      // Keep tile dimensions below the RDP's 10-bit extent, and split at wraps.
      const width = Math.min(x1 - x, flip ? sx + 1 : imageW - sx, 512);
      let left = Math.floor((flip ? sx - width + 1 : sx) / alignment) * alignment;
      let loadWidth = Math.ceil(((flip ? sx + 1 : sx + width) - left) / alignment) * alignment;

      if (block) {
        left = 0;
        loadWidth = imageW;
      }
      const line = loadWidth * bankBytes / 8;
      const rows = Math.min(Math.floor(capacity / (line * 8)), block ? blockRows : Infinity, 512);
      const s = sx - left;

      for (let y = y0; y < y1;) {
        const sy = (sourceY + rowCarry + y - y0) % imageH;
        const height = Math.min(y1 - y, imageH - sy, rows);
        ti.set(loadFormat, loadSize, imageW * loadPixels,
          imageAddress + (sy * imageW + left) * bytesPerPixel);
        loadTile.set(loadFormat, loadSize, block ? 0 : line, 0, 0, 0, 0, 0, 0, 0, 0);
        if (block) {
          loadTile.setSize(0, 0, loadWidth * loadPixels * height - 1, dxt);
          state.tmem.loadBlock(ti, loadTile);
        } else {
          loadTile.setSize(0, 0, (loadWidth * loadPixels - 1) * 4, (height - 1) * 4);
          state.tmem.loadTile(ti, loadTile);
        }
        state.invalidateTileHashes();
        renderTile.set(bg.imageFmt, bg.imageSiz, line, 0, bg.imagePal,
          gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
        renderTile.setSize(0, 0, (loadWidth - 1) * 4, (height - 1) * 4);
        renderer.texRect(0, x, y, x + width, y + height, s, 0, s + step * width, height, false);
        y += height;
      }
      x += width;
    }
  }

  executeObjRectangle(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjRectangle', false, kRenderNoRotation, cmd1, dis);
  }

  executeObjRectangleR(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjRectangleR', false, kRenderPartialTransform, cmd1, dis);
  }

  executeObjSprite(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjSprite', false, kRenderFullTransform, cmd1, dis);
  }

  executeObjLoadTxRect(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxRect', true, kRenderNoRotation, cmd1, dis);
  }

  executeObjLoadTxRectR(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxRectR', true, kRenderPartialTransform, cmd1, dis);
  }

  executeObjLoadTxSprite(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxSprite', true, kRenderFullTransform, cmd1, dis);
  }

  executeObjLoadTxtr(cmd0, cmd1, dis) {
    this.execLoadTxRenderObj('gSPObjLoadTxtr', true, kRenderNone, cmd1, dis);
  }

  execLoadTxRenderObj(method, loadTex, renderMode, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    let offset = address;

    if (loadTex) {
      this.texture.load(this.ramDV, offset);
      this.loadTexture();
      offset += 24;
    }

    if (renderMode != kRenderNone) {
      // Read the 24-byte sprite record; this is the final record in the command.
      this.sprite.load(this.ramDV, offset);
      this.renderSprite(renderMode);
    }

    let tip = '';
    if (dis) {
      dis.text(`${method}(${toString32(address)});`);
      if (loadTex) {
        tip += this.texture.toString() + '\n';
      }
      if (renderMode != kRenderNone) {
        tip += this.sprite.toString() + '\n';
      }
      dis.tip(tip);
    }
  }

  executeObjMoveMem(cmd0, cmd1, dis) {
    const address = this.state.rdpSegmentAddress(cmd1);
    const index = cmd0 & 0xffff;

    switch (index) {
      case G_OBJ_MTX:
        if (dis) {
          dis.text(`gSPObjMatrix(${toString32(address)});`);
        }
        this.setObjMatrix(address, dis);
        break;
      case G_OBJ_SUBMTX:
        if (dis) {
          dis.text(`gSPObjSubMatrix(${toString32(address)});`);
        }
        this.setObjSubMatrix(address, dis);
        break;
      default:
        if (dis) {
          dis.text(`gSPObjMoveMem(${index}, ${toString32(address)});`);
        }
    }
  }

  setObjMatrix(address, dis) {
    this.matrix.loadFullMatrix(this.ramDV, address);
    if (dis) {
      dis.tip(this.matrix.toString());
    }
  }

  setObjSubMatrix(address, dis) {
    this.matrix.loadSubMatrix(this.ramDV, address);
    if (dis) {
      dis.tip(this.matrix.toString());
    }
  }

  executeSelectDL(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('gSPSelectDL')
    if (dis) {
      dis.text(`gSPSelectDL(/* TODO */);`);
    }
  }

  executeObjRendermode(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gSPObjRenderMode(/* ignored */);`);
    }
  }

  executeTriRSP(cmd0, cmd1, dis) {
    this.gbi.warnUnimplemented('executeTriRSP')
    if (dis) {
      dis.text(`executeTriRSP(); // ignored`);
    }

    // Is this ever called during HLE?
  }

  loadTexture() {
    // S2DEX "load texture" issues the following RDP commands:
    // SetTextureImage, SetTile, [SyncLoad], [LoadBlock, LoadTile, LoadTLUT]
    const tex = this.texture;
    const tile = this.state.tiles[gbi.G_TX_LOADTILE];

    // TODO: check sid, flag and mask to figure out if the texture is already loaded.

    const ramAddress = this.state.rdpSegmentAddress(tex.image);

    // SetTextureImage - textures are always loaded as RGBA/16.
    const ti = this.state.textureImage;
    ti.set(gbi.ImageFormat.G_IM_FMT_RGBA, gbi.ImageSize.G_IM_SIZ_16b, tex.texLoadSize + 1, ramAddress);

    // SetTile - some of the parameters are embedded in the "type" field.
    const fmtSiz = (tex.type >>> 8) & 0xff;
    const fmt = (fmtSiz >>> 5) & 0x7;   // RGBA
    const siz = (fmtSiz >>> 3) & 0x3;   // 16 for loadBlock/loadTile or 4 for TLUT
    // The mask is either 0xfc (for LoadTile) or 0x00 (LoadBlock and LoadTLUT).
    const lineMask = ((tex.type << 8) >> 24);
    const line = ((tex.texLoadSize + 1) & lineMask) >>> 2;

    const palIdx = 0;
    tile.set(fmt, siz, line, tex.tileTMEM, palIdx, 0, 0, 0, 0, 0, 0);

    // texLoadSize is stored as qwords, so the *4 converts qwords into 16bpp texels
    // (there are 4 per qword), which ti.size is configured with.
    const texelsShift = 2;
    const loadSize = tex.texLoadSize << texelsShift;

    const command = (tex.type >>> 0) & 0xff;
    switch (command) {
      case LoadBlock:
        tile.setSize(0, 0, loadSize, tex.texLoadRows);
        this.state.tmem.loadBlock(ti, tile);
        break;
      case LoadTile:
        tile.setSize(0, 0, loadSize, tex.texLoadRows);
        this.state.tmem.loadTile(ti, tile);
        break;
      case LoadTLUT:
        tile.setSize(0, 0, loadSize, tex.texLoadRows);
        this.state.tmem.loadTLUT(ti, tile);
        break;
      default:
        this.gbi.warnUnimplemented(`load texture type ${tex.type}`);
        break;
    }
    this.state.invalidateTileHashes();
  }

  renderSprite(rotType) {
    const spr = this.sprite;
    const m = this.matrix;

    // In theory this should toggle between 0 and 2 for each call.
    const tileIdx = 0;
    const objX0 = spr.objX;
    const objY0 = spr.objY;
    const objX1 = spr.objW + objX0;
    const objY1 = spr.objH + objY0;

    const rTile = this.state.tiles[tileIdx];
    rTile.set(spr.imageFmt, spr.imageSiz, spr.imageStride, spr.imageAdrs, spr.imagePal, gbi.G_TX_CLAMP, 0, 0, gbi.G_TX_CLAMP, 0, 0);
    rTile.setSize(0, 0, (spr.imageW - 1) << 2, (spr.imageH - 1) << 2);

    // Used by Worms
    const swapX = spr.imageFlags & G_OBJ_FLAG_FLIPS;
    const swapY = spr.imageFlags & G_OBJ_FLAG_FLIPT;
    if (swapX || swapY) {
      this.gbi.warnUnimplemented("swapX/Y");
    }
    const s0 = 0;
    const t0 = 0;
    const s1 = spr.imageW;
    const t1 = spr.imageH;

    if (rotType == kRenderFullTransform) {
      const x0 = m.x + (m.a * objX0) + (m.b * objY0);
      const y0 = m.y + (m.c * objX0) + (m.d * objY0);
      const x1 = m.x + (m.a * objX1) + (m.b * objY0);
      const y1 = m.y + (m.c * objX1) + (m.d * objY0);
      const x2 = m.x + (m.a * objX0) + (m.b * objY1);
      const y2 = m.y + (m.c * objX0) + (m.d * objY1);
      const x3 = m.x + (m.a * objX1) + (m.b * objY1);
      const y3 = m.y + (m.c * objX1) + (m.d * objY1);
      this.gbi.renderer.texRectRot(tileIdx, x0, y0, x1, y1, x2, y2, x3, y3, s0, t0, s1, t1);
    } else if (rotType == kRenderPartialTransform) {
      // TODO: is x1/y1 decremented by 1?
      const x0 = m.x + (objX0 / m.sx);
      const y0 = m.y + (objY0 / m.sy);
      const x1 = m.x + (objX1 / m.sx);
      const y1 = m.y + (objY1 / m.sy);
      this.gbi.renderer.texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, false);
    } else if (rotType == kRenderNoRotation) {
      // TODO: is x1/y1 decremented by 1?
      const x0 = objX0;
      const x1 = objX1;
      const y0 = objY0;
      const y1 = objY1;
      this.gbi.renderer.texRect(tileIdx, x0, y0, x1, y1, s0, t0, s1, t1, false);
    }
  }
}

export class GBI1SDEX extends GBI1 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.s2dex = new S2DEXCommon(state, ramDV, this);

    this.sdexCommands = new Map([
      [s2dex1.Commands.G_BG_1CYC, this.s2dex.executeBg1cyc.bind(this.s2dex)],
      [s2dex1.Commands.G_BG_COPY, this.s2dex.executeBgCopy.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_RECTANGLE, this.s2dex.executeObjRectangle.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_SPRITE, this.s2dex.executeObjSprite.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_MOVEMEM, this.s2dex.executeObjMoveMem.bind(this.s2dex)],

      // This is set in base - why?
      // G_SPRITE2D_BASE is inherited from GBI1.

      [s2dex1.Commands.G_SELECT_DL, this.s2dex.executeSelectDL.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_RENDERMODE, this.s2dex.executeObjRendermode.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_RECTANGLE_R, this.s2dex.executeObjRectangleR.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_LOAD_TXTR, this.s2dex.executeObjLoadTxtr.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_LOAD_TX_SPRITE, this.s2dex.executeObjLoadTxSprite.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_LOAD_TX_RECT, this.s2dex.executeObjLoadTxRect.bind(this.s2dex)],
      [s2dex1.Commands.G_OBJ_LOAD_TX_RECT_R, this.s2dex.executeObjLoadTxRectR.bind(this.s2dex)],

      [GBIRDPCommands.FillTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.FillZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.TextureTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.TextureZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTextureTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTextureZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],

      // This variant of the microcode implements texrect slightly differently.
      // 0xe4 replaces base executeTexRect but 0xb3 triggers it.
      // TODO: I think this is essentially the same as the base microcode, so
      // we should unify the behaviours. For Yoshi the difference seems to be
      // that it's used to render to a temp surface (the background?) which is
      // then used in executeBg1cyc/Copy.
      // e404008000000040 gsImmp1(G_RDPHALF_0, 0x00000040);
      // b400000000000000 gsImmp1(G_RDPHALF_1, 0x00000000);
      // b300000004000400 gsImmp1(G_RDPHALF_2, 0x04000400);
      [s2dex1.Commands.G_RDPHALF_0, this.executeRDPHalf0.bind(this.s2dex)],
    ]);
  }

  getHandler(command) {
    const fn = this.sdexCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeRDPHalf0(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_0, ${toString32(cmd0)}, ${toString32(cmd1)});`);
    }
    this.state.rdpHalf0Cmd0 = cmd0;
    this.state.rdpHalf0Cmd1 = cmd1;
  }

  // 0xb3 - replaced base executeRDPHalf2 which 
  executeRDPHalf2(cmd0, cmd1, dis) {
    if (dis) {
      dis.text(`gsImmp1(G_RDPHALF_2, ${toString32(cmd1)});`);
    }
    this.rdpTexRect(this.state.rdpHalf0Cmd0, this.state.rdpHalf0Cmd1, this.state.rdpHalf1Cmd1, cmd1, dis, false);
  }
}

export class GBI2SDEX extends GBI2 {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertexStride = 2;

    this.s2dex = new S2DEXCommon(state, ramDV, this);

    this.sdexCommands = new Map([
      [s2dex2.Commands.G_OBJ_RECTANGLE, this.s2dex.executeObjRectangle.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_SPRITE, this.s2dex.executeObjSprite.bind(this.s2dex)],
      [s2dex2.Commands.G_SELECT_DL, this.s2dex.executeSelectDL.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_LOAD_TXTR, this.s2dex.executeObjLoadTxtr.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_LOAD_TX_SPRITE, this.s2dex.executeObjLoadTxSprite.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_LOAD_TX_RECT, this.s2dex.executeObjLoadTxRect.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_LOAD_TX_RECT_R, this.s2dex.executeObjLoadTxRectR.bind(this.s2dex)],
      [s2dex2.Commands.G_BG_1CYC, this.s2dex.executeBg1cyc.bind(this.s2dex)],
      [s2dex2.Commands.G_BG_COPY, this.s2dex.executeBgCopy.bind(this.s2dex)],
      [s2dex2.Commands.G_OBJ_RENDERMODE, this.s2dex.executeObjRendermode.bind(this.s2dex)],

      [GBIRDPCommands.FillTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.FillZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.TextureTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.TextureZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTextureTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],
      [GBIRDPCommands.ShadeTextureZBufferTriangle, this.s2dex.executeTriRSP.bind(this.s2dex)],

      [s2dex2.Commands.G_OBJ_RECTANGLE_R, this.s2dex.executeObjRectangleR.bind(this.s2dex)],
    ]);
  }

  getHandler(command) {
    const fn = this.sdexCommands.get(command);
    if (fn) {
      return fn;
    }
    return super.getHandler(command);
  }

  executeMoveMem(cmd0, cmd1, dis) {
    const type = cmd0 & 0xfe;
    if (type == 0) {
      const address = this.state.rdpSegmentAddress(cmd1);
      if (dis) {
        dis.text(`gSPObjMatrix(${toString32(address)});`);
      }
      this.s2dex.setObjMatrix(address, dis);
      return;
    } else if (type == 2) {
      const address = this.state.rdpSegmentAddress(cmd1);
      if (dis) {
        dis.text(`gSPObjSubMatrix(${toString32(address)});`);
      }
      this.s2dex.setObjSubMatrix(address, dis);
      return;
    }
    super.executeMoveMem(cmd0, cmd1, dis);
  }
}
