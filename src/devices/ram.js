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
    if (mapped !== 0) {
      return this.ram.readU32(mapped);
    }
    n64js.halt('virtual readU32 failed - need to throw refill/invalid');
    return 0x00000000;
  }

  readU16(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return this.ram.readU16(mapped);
    }
    n64js.halt('virtual readU16 failed - need to throw refill/invalid');
    return 0x0000;
  }

  readU8(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return this.ram.readU8(mapped);
    }
    n64js.halt('virtual readU8 failed - need to throw refill/invalid');
    return 0x00;
  }

  readS32(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return this.ram.readS32(mapped);
    }
    // FIXME: need to somehow interrupt the current instruction from executing, before it has chance to modify state.
    // For now, goldeneye hits this initially when reading the current instruction. I laemly return 0 so that I execute a NOP and then jump to the exception handler.
    //    n64js.halt('virtual readS32 failed - need to throw refill/invalid');
    return 0;
  }

  readS16(address) {
    const mapped = n64js.cpu0.translateRead(address) & 0x007fffff;
    if (mapped !== 0) {
      return this.ram.readS16(mapped);
    }
    n64js.halt('virtual readS16 failed - need to throw refill/invalid');
    return 0x0000;
  }

  readS8(address) {
    const mapped = n64js.cpu0.translateRead(address);
    if (mapped !== 0) {
      return this.ram.readS8(mapped);
    }
    n64js.halt('virtual readS8 failed - need to throw refill/invalid');
    return 0x00;
  }

  write32(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      this.ram.write32(mapped, value);
      return;
    }
    n64js.halt('virtual write32 failed - need to throw refill/invalid');
  }

  write16(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      this.ram.write16(mapped, value);
      return;
    }
    n64js.halt('virtual write16 failed - need to throw refill/invalid');
  }

  write8(address, value) {
    const mapped = n64js.cpu0.translateWrite(address) & 0x007fffff;
    if (mapped !== 0) {
      this.ram.write8(mapped, value);
      return;
    }
    n64js.halt('virtual write8 failed - need to throw refill/invalid');
  }
}


export class CachedMemDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("RAM", hardware, hardware.ram, rangeStart, rangeEnd);
  }

  // This function gets hit A LOT, so eliminate as much fat as possible.
  readU32(address) {
    const off = address - 0x80000000;
    return ((this.u8[off + 0] << 24) | (this.u8[off + 1] << 16) | (this.u8[off + 2] << 8) | (this.u8[off + 3])) >>> 0;
  }

  readS32(address) {
    const off = address - 0x80000000;
    return (this.u8[off + 0] << 24) | (this.u8[off + 1] << 16) | (this.u8[off + 2] << 8) | (this.u8[off + 3]);
  }

  write32(address, value) {
    const off = address - 0x80000000;
    this.u8[off + 0] = value >> 24;
    this.u8[off + 1] = value >> 16;
    this.u8[off + 2] = value >> 8;
    this.u8[off + 3] = value;
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
