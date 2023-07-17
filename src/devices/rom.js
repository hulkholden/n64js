import { Device } from './device.js';
import { toString32, toString16, toString8 } from '../format.js';
import * as logger from '../logger.js';

export class ROMD1A1Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a1", hardware, hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw `Writing to rom d1a1 ${toString32(value)} -> [${toString32(address)}]`; };
    write16(address, value) { throw `Writing to rom d1a1 ${toString16(value)} -> [${toString32(address)}]`; };
    write8(address, value) { throw `Writing to rom d1a1 ${toString8(value)} -> [${toString32(address)}]`; };
}

export class ROMD1A2Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a2", hardware, hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw `Writing to rom d1a2 ${toString32(value)} -> [${toString32(address)}]`; };
    write16(address, value) { throw `Writing to rom d1a2 ${toString16(value)} -> [${toString32(address)}]`; };
    write8(address, value) { throw `Writing to rom d1a2 ${toString8(value)} -> [${toString32(address)}]`; };
}

export class ROMD1A3Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a3", hardware, hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw `Writing to rom d1a3 ${toString32(value)} -> [${toString32(address)}]`; };
    write16(address, value) { throw `Writing to rom d1a3 ${toString16(value)} -> [${toString32(address)}]`; };
    write8(address, value) { throw `Writing to rom d1a3 ${toString8(value)} -> [${toString32(address)}]`; };
}

export class ROMD2A1Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("ROMd2a1", hardware, null, rangeStart, rangeEnd);
    }

    read(address) {
        // 0xa5000508 is 64DD region.. set -1 fixes F-Zero U
        if (address == 0xa5000508) {
            logger.log('Reading from ROMd2a1 0xa5000508 - spoofing ~0 value')
            return ~0;
        }
        logger.log(`Reading from invalid ROMd2a1 address ${toString32(address)}`);
        return 0;
    }

    readU32(address) { return this.read(address) >>> 0; }
    readU16(address) { return this.read(address) & 0xffff; };
    readU8(address) { return this.read(address) & 0xff; };

    readS32(address) { return this.read(address) >> 0; }
    readS16(address) { return this.read(address) & 0xffff; };
    readS8(address) { return this.read(address) & 0xff; };

    write32(address, value) { throw `Writing to rom ${toString32(value)} -> [${toString32(address)}]`; };
    write16(address, value) { throw `Writing to rom ${toString16(value)} -> [${toString32(address)}]`; };
    write8(address, value) { throw `Writing to rom ${toString8(value)} -> [${toString32(address)}]`; };
}

export class ROMD2A2Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("ROMd2a2", hardware, null, rangeStart, rangeEnd);
    }

    readU32(address) { throw `Reading u32 from rom d2a2 [${toString32(address)}]`; };
    readU16(address) { throw `Reading u16 from rom d2a2 [${toString32(address)}]`; };
    readU8(address) { throw `Reading u8 from rom d2a2 [${toString32(address)}]`; };
    readS32(address) { throw `Reading s32 from rom d2a2 [${toString32(address)}]`; };
    readS16(address) { throw `Reading s16 from rom d2a2 [${toString32(address)}]`; };
    readS8(address) { throw `Reading s8 from rom d2a2 [${toString32(address)}]`; };
    write32(address, value) { throw `Writing to rom ${toString32(value)} -> [${toString32(address)}]`; };
    write16(address, value) { throw `Writing to rom ${toString16(value)} -> [${toString32(address)}]`; };
    write8(address, value) { throw `Writing to rom ${toString8(value)} -> [${toString32(address)}]`; };
}
