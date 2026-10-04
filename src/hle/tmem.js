/*global n64js*/

import { toString16, toString32 } from '../format.js';
import * as gbi from './gbi.js';

// TODO: provide a HLE object and instantiate these in the constructor/reset.
function getRamU8Array() { return n64js.hardware().cachedMemDevice.u8; }

export class TMEM {
  constructor() {
    // Physical TMEM, in N64 byte order. RGBA32 stores RG in the lower 2 KiB
    // and BA in the upper 2 KiB; YUV stores UV below and Y above. Each half's
    // four 16-bit banks are interleaved within 64-bit words. No decoded layout
    // is retained here: subsequent loads can reinterpret or overwrite it.
    const tmemBuffer = new ArrayBuffer(4096);
    this.tmemData32 = new Int32Array(tmemBuffer);
    this.tmemData = new Uint8Array(tmemBuffer);
  }

  /**
   * Loads a block to TMEM.
   * @param {TextureImage} ti RDP texture image.
   * @param {Tile} tile Load tile with integer S/T bounds and DXT in its lrt register.
   * @param {DebugController?} dc An optional debug controller for displaying tooltips.
   */
  loadBlock(ti, tile, dc) {
    // LoadBlock uses integer source coordinates, unlike LoadTile's 10.2
    // coordinates. F-Zero X uses nonzero ult to upload successive image strips.
    // The command stores DXT in the fourth tile bounds register.
    const { uls, ult, lrs, lrt: dxt } = tile;
    // The load edge walker sign-extends its 12-bit source X and masks Y to
    // ten bits. Ordinary uploads use nonnegative X well below this boundary.
    const ramAddress = ti.calcAddress((uls << 20) >> 20, ult & 0x3ff);
    const texels = (lrs - uls + 1) & 0xfff;
    const step = 16 >>> ti.size;
    if (dc) {
      dc.tip(`texels ${texels}, qwords ${Math.ceil(texels / step)}`);
    }

    // A 4-bit source image crashes the RDP loading pipeline. Preserve TMEM;
    // emulating the resulting pipeline lockup is outside this memory model.
    if (ti.size === gbi.ImageSize.G_IM_SIZ_4b) {
      return;
    }
    const ram = getRamU8Array();
    if (canCopyQwords(ti, tile, ram, ramAddress)) {
      const ram32 = new Int32Array(ram.buffer, ram.byteOffset, ram.byteLength >>> 2);
      for (let s = 0, qword = 0; s < texels; s += step, qword++) {
        const t = (qword * dxt) >>> 11;
        copyLoadQword(this.tmemData32, ram32, ramAddress + qword * 8,
          (tile.tmem + tile.line * t + qword) * 8, t & 1);
      }
      return;
    }
    // DXT is a 1.11 accumulator increment per source qword. Its integer part
    // affects both the odd-row swap and the destination's tile.line offset.
    const mode = getLoadMode(tile);
    const shiftS = getLoadShiftS(tile);
    for (let s = 0, qword = 0; s < texels; s += step, qword++) {
      const t = (qword * dxt) >>> 11;
      const source = ramAddress + qword * 8;
      writeLoadQword(this.tmemData, readRam32(ram, source), readRam32(ram, source + 4),
        (tile.tmem + tile.line * t) * 4, (s >>> shiftS) & 0x7ff, (t & 1) << 1, mode);
    }
  }

  /**
   * Loads a tile to TMEM.
   * @param {TextureImage} ti RDP texture image. 
   * @param {Tile} tile Load tile with bounds in 10.2 format.
   * @param {DebugController?} dc An optional debug controller for displaying tooltips.
   */
  loadTile(ti, tile, dc) {
    const { uls, ult, lrs, lrt } = tile;
    const s0 = uls >>> 2;
    const t0 = ult >>> 2;
    const t1 = lrt >>> 2;

    const w = loadTileWidth(uls, ult, lrs, lrt);
    const h = (t1 + 1) - t0;
    
    const ramAddress = ti.calcAddress(s0, t0);
    const ramStride = ti.stride();

    if (dc) {
      dc.tip(`size (${w} x ${h}), ramStride ${ramStride}, tmemStride ${tile.line << 3}, ramOffset ${toString32(ramAddress)}, tmemOffset ${toString16(tile.tmem << 3)}`);
    }

    if (ti.size === gbi.ImageSize.G_IM_SIZ_4b) {
      return;
    }
    const ram = getRamU8Array();
    const step = 16 >>> ti.size;
    if (canCopyQwords(ti, tile, ram, ramAddress) && !(ramStride & 3)) {
      const ram32 = new Int32Array(ram.buffer, ram.byteOffset, ram.byteLength >>> 2);
      for (let y = 0; y < h; y++) {
        for (let s = 0, qword = 0; s < w; s += step, qword++) {
          const loadS = loadTileOffsetS(uls, s);
          const dst = (tile.tmem + tile.line * y) * 8 + (loadS << ti.size >> 1);
          copyLoadQword(this.tmemData32, ram32, ramAddress + y * ramStride + qword * 8, dst, y & 1);
        }
      }
      return;
    }
    const mode = getLoadMode(tile);
    const shiftS = getLoadShiftS(tile);
    for (let y = 0; y < h; ++y) {
      const base = (tile.tmem + tile.line * y) * 4;
      const swap = (y & 1) << 1;
      // Each iteration writes a complete 64-bit fetch, including the final
      // partial group of texels. Unwritten stride padding retains old TMEM.
      for (let s = 0, qword = 0; s < w; s += step, qword++) {
        const loadS = loadTileOffsetS(uls, s);
        const source = ramAddress + y * ramStride + qword * 8;
        writeLoadQword(this.tmemData, readRam32(ram, source), readRam32(ram, source + 4),
          base, (loadS >>> shiftS) & 0x7ff, swap, mode);
      }
    }
  }

  /**
   * S2DEX assembles a tile from a circular, linear background image. This is
   * equivalent to split LoadTile transfers, including odd-row swaps, but also
   * joins the final source row to the first for the filter's extra texels.
   */
  loadBackground(ti, tile, sourceXBytes, sourceY, stride, imageHeight, width, height) {
    const ram = getRamU8Array();
    const imageBytes = stride * imageHeight;
    const step = 16 >>> ti.size;
    const mode = getLoadMode(tile), shiftS = getLoadShiftS(tile);
    for (let y = 0; y < height; y++) {
      for (let s = 0, qword = 0; s < width; s += step, qword++) {
        const offset = (sourceY + y) * stride + sourceXBytes + qword * 8;
        const source = ti.address + ((offset % imageBytes) + imageBytes) % imageBytes;
        writeLoadQword(this.tmemData, readRam32(ram, source), readRam32(ram, source + 4),
          (tile.tmem + tile.line * y) * 4, (s >>> shiftS) & 0x7ff, (y & 1) << 1, mode);
      }
    }
  }

  /**
   * Loads a TLUT into TMEM.
   * @param {TextureImage} ti RDP texture image. 
   * @param {Tile} tile Load tile with bounds in 10.2 format.
   * @param {DebugController?} dc An optional debug controller for displaying tooltips.
   */
  loadTLUT(ti, tile, dc) {
    const { uls, ult, lrs, lrt } = tile;
    const s0 = uls >>> 2;
    const t0 = ult >>> 2;

    const ramAddress = ti.calcAddress(s0, t0);
    const texels = loadTileWidth(uls, ult, lrs, lrt);

    if (dc) {
      dc.tip(`count ${texels}, tmemOffset ${toString16(tile.tmem << 3)}`);
    }
    // TLUT loads cannot span multiple rows. The normal palette upload uses a
    // 16-bit source and a 4-bit load tile, replicating one entry into four banks.
    if (ti.size === gbi.ImageSize.G_IM_SIZ_4b || (lrt >>> 2) !== t0) {
      return;
    }
    const ram = getRamU8Array();
    const step = ti.size === gbi.ImageSize.G_IM_SIZ_16b ? 1 : 16 >>> ti.size;
    const sourceStep = ti.size === gbi.ImageSize.G_IM_SIZ_16b ? 2 : 8;
    const writeQword = loadWriters[getLoadMode(tile)];
    const shiftS = getLoadShiftS(tile);
    const stepS = 64 >>> ti.size;
    const base = tile.tmem * 4;
    // Every source increment is even, so alignment is fixed for the load.
    if (!(ramAddress & 1)) {
      for (let x = 0, qword = 0; x < texels; x += step, qword++) {
        const source = ramAddress + qword * sourceStep;
        const entry = (ram[source & 0xffffff] << 8) | ram[(source + 1) & 0xffffff];
        const word = (entry << 16) | entry;
        writeQword(this.tmemData, word, word, base, ((qword * stepS) >>> shiftS) & 0x7ff, 0);
      }
      return;
    }
    for (let x = 0, qword = 0; x < texels; x += step, qword++) {
      const source = ramAddress + qword * sourceStep;
      writeQword(this.tmemData, readRam32(ram, source), readRam32(ram, source + 4),
        base, ((qword * stepS) >>> shiftS) & 0x7ff, 0);
    }
  }

  // Snapshot identity covers both banks, including all physical TLUT entries.
  // Tile interpretation is supplied separately to the shader.
  hashContents() {
    return hashTmem(this.tmemData32);
  }
}

function loadTileOffsetS(uls, s) {
  // Convert the 10.2 origin and whole-texel offset to 10.5 coordinates, then
  // wrap as signed 16-bit before subtracting the origin. This matters for
  // long spans with a 4/8-bit load tile. Return the offset in whole texels.
  const originS = uls << 3;
  return ((((originS + (s << 5)) << 16) >> 16) - originS) >> 5;
}

function loadTileWidth(uls, ult, lrs, lrt) {
  // Loads share the RDP edge walker. A single row starting at subpixel 3 has
  // no covered subpixels before the exclusive bottom edge; its rightmost X
  // stays zero, and the span length still wraps to twelve bits.
  const emptyRow = (ult & 3) === 3 && (ult >>> 2) === (lrt >>> 2);
  return ((emptyRow ? 0 : lrs >>> 2) - (uls >>> 2) + 1) & 0xfff;
}

// XXH32 over the complete 4 KiB physical memory. Native-endian words are
// sufficient for this in-process cache identity.
// Algorithm: https://github.com/Cyan4973/xxHash/blob/dev/doc/xxhash_spec.md
function hashTmem(words) {
  let a = (0x9e3779b1 + 0x85ebca77) | 0;
  let b = 0x85ebca77 | 0;
  let c = 0;
  let d = -0x9e3779b1 | 0;
  for (let i = 0; i < 1024; i += 4) {
    a = xxh32Round(a, words[i]);
    b = xxh32Round(b, words[i + 1]);
    c = xxh32Round(c, words[i + 2]);
    d = xxh32Round(d, words[i + 3]);
  }
  let hash = (rotateLeft32(a, 1) + rotateLeft32(b, 7) + rotateLeft32(c, 12) + rotateLeft32(d, 18) + 4096) | 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca77);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae3d);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function xxh32Round(hash, word) {
  hash = (hash + Math.imul(word, 0x85ebca77)) | 0;
  return Math.imul(rotateLeft32(hash, 13), 0x9e3779b1);
}

function rotateLeft32(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}

// The loading pipeline fetches 64 bits from RDRAM, then routes four halfwords
// into TMEM's banks. Source size controls the fetch step; load-tile size and
// format control destination addresses and routing, even when they disagree.
// Reference: Angrylion's loading_pipeline/get_tmem_idx and paraLLEl-RDP's
// parallel-rdp/shaders/tmem_update.comp. Bytes here are big endian, without
// the reference implementations' host-endian word XORs.
const LoadMode = { Ordinary: 0, Rgba32: 1, Yuv: 2 };

function getLoadMode(tile) {
  if (tile.format === gbi.ImageFormat.G_IM_FMT_YUV) {
    return LoadMode.Yuv;
  }
  if (tile.format === gbi.ImageFormat.G_IM_FMT_RGBA && tile.size === gbi.ImageSize.G_IM_SIZ_32b) {
    return LoadMode.Rgba32;
  }
  return LoadMode.Ordinary;
}

function getLoadShiftS(tile) {
  if (tile.format === gbi.ImageFormat.G_IM_FMT_YUV || tile.size === gbi.ImageSize.G_IM_SIZ_8b) {
    return 1;
  }
  return tile.size === gbi.ImageSize.G_IM_SIZ_4b ? 2 : 0;
}

// Keep calls direct for block/tile loads: indirect dispatch was slower in
// Chromium. Palette loads benefit from selecting a writer once instead.
// See tmem_load.bench.js for the comparison benchmark.
function writeLoadQword(tmem, word0, word1, base, halfwordS, swap, mode) {
  if (mode === LoadMode.Yuv) {
    writeYuvQword(tmem, word0, word1, base, halfwordS, swap);
  } else if (mode === LoadMode.Rgba32) {
    writeRgba32Qword(tmem, word0, word1, base, halfwordS, swap);
  } else {
    writeOrdinaryQword(tmem, word0, word1, base, halfwordS, swap);
  }
}

const loadWriters = [writeOrdinaryQword, writeRgba32Qword, writeYuvQword];

function writeYuvQword(tmem, word0, word1, base, halfwordS, swap) {
  const first = (base + halfwordS) & 0x7fd;
  const lane = halfwordS & 2;
  const dst0 = (((first + ((lane - first) & 3)) ^ swap) & 0x3ff) * 2;
  const dst1 = (((first + ((lane + 1 - first) & 3)) ^ swap) & 0x3ff) * 2;
  writeTmem16(tmem, dst0, ((word0 >>> 16) & 0xff00) | ((word0 >>> 8) & 0xff));
  writeTmem16(tmem, dst1, ((word1 >>> 16) & 0xff00) | ((word1 >>> 8) & 0xff));
  writeTmem16(tmem, dst0 | 0x800, ((word0 >>> 8) & 0xff00) | (word0 & 0xff));
  writeTmem16(tmem, dst1 | 0x800, ((word1 >>> 8) & 0xff00) | (word1 & 0xff));
}

function writeRgba32Qword(tmem, word0, word1, base, halfwordS, swap) {
  // Two halfwords in each half of TMEM. Odd rows exchange the 32-bit halves
  // of each 64-bit word, even when DXT changes parity between the two writes.
  const first = (base + halfwordS) & 0x7fd;
  const lane = halfwordS & 2;
  const dst0 = (((first + ((lane - first) & 3)) ^ swap) & 0x3ff) * 2;
  const dst1 = (((first + ((lane + 1 - first) & 3)) ^ swap) & 0x3ff) * 2;
  writeTmem16(tmem, dst0, word0 >>> 16);
  writeTmem16(tmem, dst1, word1 >>> 16);
  writeTmem16(tmem, dst0 | 0x800, word0);
  writeTmem16(tmem, dst1 | 0x800, word1);
}

function writeOrdinaryQword(tmem, word0, word1, base, halfwordS, swap) {
  const first = (base + halfwordS) & 0x7fd;
  const upper = first & 0x400;
  for (let lane = 0; lane < 4; lane++) {
    const dst = ((((first + ((lane - first) & 3)) ^ swap) & 0x3ff) | upper) * 2;
    const word = lane < 2 ? word0 : word1;
    writeTmem16(tmem, dst, word >>> ((1 - (lane & 1)) * 16));
  }
}

function readRam32(ram, address) {
  return (ram[address & 0xffffff] << 24) | (ram[(address + 1) & 0xffffff] << 16) |
    (ram[(address + 2) & 0xffffff] << 8) | ram[(address + 3) & 0xffffff];
}

function writeTmem16(tmem, address, value) {
  tmem[address] = value >>> 8;
  tmem[address + 1] = value;
}

// Ordinary aligned 8/16-bit loads can copy host words directly while retaining
// the same DXT, wrapping and odd-row semantics as the bank-routing path.
function canCopyQwords(ti, tile, ram, address) {
  return ti.size === tile.size && ti.size <= gbi.ImageSize.G_IM_SIZ_16b &&
    tile.format !== gbi.ImageFormat.G_IM_FMT_YUV && !((address | ram.byteOffset) & 3);
}

function copyLoadQword(tmem32, ram32, source, destination, odd) {
  const src = (source & 0xffffff) >>> 2;
  const dst = ((destination >>> 2) ^ odd) & 0x3ff;
  tmem32[dst] = ram32[src];
  tmem32[dst ^ 1] = ram32[(src + 1) & 0x3fffff];
}
