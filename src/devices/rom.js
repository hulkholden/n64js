import { Device } from './device.js';
import * as logger from '../logger.js';


export class ROMD1A1Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a1", hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw 'Writing to rom d1a1'; };
    write16(address, value) { throw 'Writing to rom d1a1'; };
    write8(address, value) { throw 'Writing to rom d1a1'; };
}

export class ROMD1A2Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a2", hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw 'Writing to rom d1a2'; };
    write16(address, value) { throw 'Writing to rom d1a2'; };
    write8(address, value) { throw 'Writing to rom d1a2'; };
}

export class ROMD1A3Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        // FIXME: rom is initally unmapped, and the underlying Device isn't updated as it's mapped in.
        super("ROMd1a3", hardware.rom, rangeStart, rangeEnd);
    }

    write32(address, value) { throw 'Writing to rom d1a3'; };
    write16(address, value) { throw 'Writing to rom d1a3'; };
    write8(address, value) { throw 'Writing to rom d1a3'; };
}

export class ROMD2A1Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("ROMd2a1", null, rangeStart, rangeEnd);
    }

    readU32(address) { logger.log('reading noise'); return n64js.getRandomU32(); };
    readU16(address) { logger.log('reading noise'); return n64js.getRandomU32() & 0xffff; };
    readU8(address) { logger.log('reading noise'); return n64js.getRandomU32() & 0xff; };
    readS32(address) { logger.log('reading noise'); return n64js.getRandomU32(); };
    readS16(address) { logger.log('reading noise'); return n64js.getRandomU32() & 0xffff; };
    readS8(address) { logger.log('reading noise'); return n64js.getRandomU32() & 0xff; };
    write32(address, value) { throw 'Writing to rom'; };
    write16(address, value) { throw 'Writing to rom'; };
    write8(address, value) { throw 'Writing to rom'; };
}

export class ROMD2A2Device extends Device {
    constructor(hardware, rangeStart, rangeEnd) {
        super("ROMd2a2", null, rangeStart, rangeEnd);
    }

    readU32(address) { throw 'Reading from rom d2a2'; };
    readU16(address) { throw 'Reading from rom d2a2'; };
    readU8(address) { throw 'Reading from rom d2a2'; };
    readS32(address) { throw 'Reading from rom d2a2'; };
    readS16(address) { throw 'Reading from rom d2a2'; };
    readS8(address) { throw 'Reading from rom d2a2'; };
    write32(address, value) { throw 'Writing to rom'; };
    write16(address, value) { throw 'Writing to rom'; };
    write8(address, value) { throw 'Writing to rom'; };
}
