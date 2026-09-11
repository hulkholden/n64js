import * as base64 from './base64.js';

export class Mempack {
  constructor() {
    this.data = new Uint8Array(32 * 1024);
    this.dirty = false;
  }

  init(item) {
    this.dirty = false;
    this.data.fill(0);
    // Restore from local storage if provided.
    if (item && item.data) {
      const arr = base64.decodeArray(item.data);
      this.data.set(arr.subarray(0, this.data.length));
    } else {
      formatMempack(this.data);
    }
  }
}

// Write an empty Controller Pak filesystem into zero-filled memory.
function formatMempack(data) {
  // Page 0 contains four copies of the 32-byte ID block. Use a stable zero
  // serial, device ID 1 (writable), one 32 KiB bank, and version 0.
  const id = new DataView(data.buffer, data.byteOffset + 0x20, 32);
  id.setUint16(0x18, 1);
  id.setUint8(0x1a, 1);
  let checksum = 0;
  for (let offset = 0; offset < 0x1c; offset += 2) {
    checksum += id.getUint16(offset);
  }
  id.setUint16(0x1c, checksum & 0xffff);
  // Sum of the one's complements of 14 words: (14 * 0xffff) - checksum.
  id.setUint16(0x1e, (0xfff2 - checksum) & 0xffff);
  for (const offset of [0x60, 0x80, 0xc0]) {
    data.copyWithin(offset, 0x20, 0x40);
  }

  // Pages 1 and 2 are the primary and backup allocation tables. The first
  // five pages hold metadata; pages 5..127 are free (big-endian inode 0x0003).
  // The checksum covers the bytes of those 123 usable entries only.
  for (let page = 5; page < 128; page++) {
    data[0x100 + page * 2 + 1] = 3;
  }
  data[0x101] = (123 * 3) & 0xff;
  data.copyWithin(0x200, 0x100, 0x200);
  // Pages 3 and 4 contain 16 empty directory entries; remaining pages are data.
}
