// Experimental, last-event-per-byte capture. Event IDs are independent of the
// view so future read/texture/CImg/ZImg annotations can use the same range API.
export const MemorySource = Object.freeze({ CPU: 1, PI: 2, SI: 3, SP: 4 });

export function compactBits(value) {
  value &= 0x55555555;
  value = (value | (value >>> 1)) & 0x33333333;
  value = (value | (value >>> 2)) & 0x0f0f0f0f;
  value = (value | (value >>> 4)) & 0x00ff00ff;
  return (value | (value >>> 8)) & 0xffff;
}

export function pixelAddress(x, y) {
  let address = 0;
  for (let bit = 0; bit < 12; bit++) {
    address |= ((x >>> bit) & 1) << (bit * 2);
    address |= ((y >>> bit) & 1) << (bit * 2 + 1);
  }
  return address;
}

export class MemoryActivity {
  constructor(size) {
    if (size !== 4 * 1024 * 1024 && size !== 8 * 1024 * 1024) {
      throw new Error('Memory activity requires 4 or 8 MiB RAM');
    }
    this.size = size;
    this.width = size === 4 * 1024 * 1024 ? 2048 : 4096;
    this.height = 2048;
    this.sources = new Uint8Array(size);
    this.times = new Uint32Array(size);
    this.dirtyRows = new Set();
    this.paused = false;
    this.readMode = false;
    this.cpuReads = true;
    this.reset();
  }

  reset() {
    this.frame = 0;
    this.sources.fill(0);
    this.times.fill(0);
    for (let y = 0; y < this.height; y++) {
      this.dirtyRows.add(y);
    }
  }

  advance() {
    if (!this.paused) {
      this.frame = (this.frame + 1) >>> 0;
    }
  }

  index(address) {
    return compactBits(address) + compactBits(address >>> 1) * this.width;
  }

  setReadMode(enabled) {
    if (this.readMode !== enabled) {
      this.readMode = enabled;
      this.reset();
    }
  }

  markRead(address, length, source) {
    if (this.readMode && (source !== MemorySource.CPU || this.cpuReads)) {
      this.recordRange(address, length, source);
    }
  }

  markRange(address, length, source) {
    if (!this.readMode) {
      this.recordRange(address, length, source);
    }
  }

  recordRange(address, length, source) {
    if (this.paused) {
      return;
    }
    const end = Math.min(this.size, address + length);
    for (let a = Math.max(0, address); a < end; a++) {
      const y = compactBits(a >>> 1);
      const index = compactBits(a) + y * this.width;
      this.sources[index] = source;
      this.times[index] = this.frame;
      this.dirtyRows.add(y);
    }
  }

  // N64 stores are big endian; only bytes selected by SWL/SWR/SDL/SDR count.
  markMasked(address, bytes, mask, source = MemorySource.CPU) {
    for (let i = 0; i < bytes; i++) {
      if ((mask >> BigInt((bytes - i - 1) * 8)) & 255n) {
        this.markRange(address + i, 1, source);
      }
    }
  }
}
