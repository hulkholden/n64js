import { Device } from './device.js';
import { toString32 } from '../format.js';
import * as logger from '../logger.js';

export class MappedMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("VMEM", hardware, null, rangeStart, rangeEnd);
    this.ram = hardware.ram;
  }

  readInternal32(address) {
    const mapped = n64js.cpu0.translateReadInternal(address) & 0x007fffff;
    if (mapped !== 0) {
      if (mapped + 4 <= this.ram.u8.length) {
        return this.ram.readU32(mapped);
      }
    }
    return 0x00000000;
  }

  writeInternal32(address, value) {
    const mapped = n64js.cpu0.translateReadInternal(address) & 0x007fffff;
    if (mapped !== 0) {
      if (mapped + 4 <= this.ram.u8.length) {
        this.ram.write32(mapped, value);
      }
    }
  }

  readU32(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    return this.ram.readU32(mapped);
  }

  readU16(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    return this.ram.readU16(mapped);
  }

  readU8(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    return this.ram.readU8(mapped);
  }

  readS32(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    return this.ram.readS32(mapped);
  }

  readS16(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    return this.ram.readS16(mapped);
  }

  readS8(address) {
    const mapped = n64js.cpu0.translateRead(address);
    return this.ram.readS8(mapped);
  }

  write64masked(address, value, mask) {
    // Align address to 64 bits after translation.
    const mapped = n64js.cpu0.translateWrite(address) & 0x007ffff8;
    this.ram.write64masked(mapped, value, mask);
  }

  write32masked(address, value, mask) {
    // Align address to 32 bits after translation.
    const mapped = n64js.cpu0.translateWrite(address) & 0x007ffffc;
    this.ram.write32masked(mapped, value, mask);
  }

  write32(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    this.ram.write32(mapped, value);
  }

  write16(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    this.ram.write16(mapped, value);
  }

  write8(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    this.ram.write8(mapped, value);
  }
}


export class CachedMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("RAM", hardware, hardware.ram, rangeStart, rangeEnd);

    // Used by n64js.getRamS32Array.
    this.dataView = this.mem.dataView;
    this.s32 = new Int32Array(this.mem.arrayBuffer);
  }

  // Provide specialised implementations for some hot functions - hard-code some calcuations for performance.
  readU32(address) {
    const off = address - 0x80000000;
    return this.dataView.getUint32(off, false); 
  }

  readS32(address) {
    const off = address - 0x80000000;
    return this.dataView.getInt32(off, false); 
  }

  write32(address, value) {
    const off = address - 0x80000000;
    this.dataView.setUint32(off, value, false); 
  }
}

export class UncachedMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("RAM", hardware, hardware.ram, rangeStart, rangeEnd);
  }
}

export class InvalidMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("Invalid", hardware, null, rangeStart, rangeEnd);
  }

  read(address) {
    logger.log(`Reading from invalid address ${toString32(address)}`);
    return 0;
  }

  write(address) {
    logger.log(`Writing to invalid address ${toString32(address)}`);
  }

  readU32(address) { return this.read(address) >>> 0; }
  readU16(address) { return this.read(address) & 0xffff; };
  readU8(address) { return this.read(address) & 0xff; };

  readS32(address) { return this.read(address) >> 0; }
  readS16(address) { return this.read(address) & 0xffff; };
  readS8(address) { return this.read(address) & 0xff; };

  write32(address, value) { this.write(address, value); };
  write16(address, value) { this.write(address, value); };
  write8(address, value) { this.write(address, value); };
}

export class RDRamRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("RDRAMReg", hardware, hardware.rdram_reg, rangeStart, rangeEnd);
  }

  calcEA(address) {
    return address & 0xff;
  }
}
