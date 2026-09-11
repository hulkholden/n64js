/*
 * Controller Pak filesystem: one 32 KiB bank, split into 128 256-byte pages.
 * Multi-byte filesystem fields are big-endian.
 *
 * +-------------+---------+---------------------------------------------+
 * | Bytes (hex) | Pages   | Contents                                    |
 * +-------------+---------+---------------------------------------------+
 * | 0000-00ff   | 0       | Pak ID and backup copies                    |
 * | 0100-01ff   | 1       | Primary allocation table                    |
 * | 0200-02ff   | 2       | Backup allocation table                     |
 * | 0300-04ff   | 3-4     | Note directory: 16 entries of 32 bytes       |
 * | 0500-7fff   | 5-127   | Note data: 123 usable pages                  |
 * +-------------+---------+---------------------------------------------+
 *
 * The ID has four 32-byte copies at 0x20, 0x60, 0x80 and 0xc0. Each holds
 * the serial, device ID, bank count, version, checksum and inverse checksum.
 * Each allocation table has one 16-bit entry per page: 0x0003 means free,
 * 0x0001 ends a note's chain, and other valid entries point to the next page.
 * Entries 0-4 are reserved; byte 1 stores the low eight bits of the sum of
 * all bytes in entries 5-127. Directory entries identify each note and its
 * first data page. A freshly formatted pak has no notes and 123 free pages.
 */

import * as base64 from './base64.js';

const kMempackSize = 32 * 1024;
const kDeviceIDWritable = 0x0001;
const kNumBanks = 1;
const kFormatVersion = 0;
const kIDChecksumWords = 14;
const kNumPages = 128;
const kFirstDataPage = 5;
const kNumDataPages = kNumPages - kFirstDataPage;
const kInodeFree = 0x0003;

export class Mempack {
  constructor() {
    this.data = new Uint8Array(kMempackSize);
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
  id.setUint16(0x18, kDeviceIDWritable);
  id.setUint8(0x1a, kNumBanks);
  id.setUint8(0x1b, kFormatVersion);
  let checksum = 0;
  for (let offset = 0; offset < 0x1c; offset += 2) {
    checksum += id.getUint16(offset);
  }
  id.setUint16(0x1c, checksum & 0xffff);
  // Sum of the one's complements of the ID words.
  id.setUint16(0x1e, (kIDChecksumWords * 0xffff - checksum) & 0xffff);
  for (const offset of [0x60, 0x80, 0xc0]) {
    data.copyWithin(offset, 0x20, 0x40);
  }

  // Pages 1 and 2 are the primary and backup allocation tables. The first
  // five pages hold metadata; pages 5..127 are free (big-endian inode 0x0003).
  // The checksum covers the bytes of those 123 usable entries only.
  for (let page = kFirstDataPage; page < kNumPages; page++) {
    data[0x100 + page * 2 + 1] = kInodeFree;
  }
  data[0x101] = (kNumDataPages * kInodeFree) & 0xff;
  data.copyWithin(0x200, 0x100, 0x200);
  // Pages 3 and 4 contain 16 empty directory entries; remaining pages are data.
}
