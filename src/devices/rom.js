import { Device } from './device.js';
import { toString32, toString16, toString8 } from '../format.js';
import * as logger from '../logger.js';

const dbgOutWriteLen = 0xb3ff0014
const dbgOutBufStart = 0xb3ff0020;
const dbgOutBufLen = 512;
const dbgOutBufEnd = dbgOutBufStart + dbgOutBufLen;

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

        // A buffer for storing debug output, mapped to dbgOutBufStart.
        // This is flushed on writes to dbgOutWriteLen.
        this.debugBuffer = new ArrayBuffer(dbgOutBufLen);
        this.debugBufferU32 = new Uint32Array(this.debugBuffer);
        this.debugBufferU8 = new Uint8Array(this.debugBuffer);
        // The accumulated debug output.
        // Complete lines (upto and including a newline) are flushed to the debug console.
        this.output = ''
    }

    // LH and LB are broken -every other 16 bit word is unreachable.
    calcEA(address) {
        return ((address - this.rangeStart) + 2) & ~2;
    }

    write32(address, value) {
        if (address == dbgOutWriteLen) {
            return this.writeDebugBufferLen(value);
        }
        if (address >= dbgOutBufStart && address < dbgOutBufEnd) {
            return this.writeDebugBuffer32(address - dbgOutBufStart, value);
        }

        console.log(`[unhandled] Writing word to rom d1a2 ${toString32(value)} -> [${toString32(address)}]`);
    };

    write16(address, value) { console.log(`[unhandled] Writing to rom d1a2 ${toString16(value)} -> [${toString32(address)}]`); };
    write8(address, value) { console.log(`[unhandled] Writing to rom d1a2 ${toString8(value)} -> [${toString32(address)}]`); };

    writeDebugBufferLen(value) {
        if (value > dbgOutBufLen) {
            console.log(`debug buffer value too long (${value}), truncating`);
            value = dbgOutBufLen;
        }
        for (let i = 0; i < value; i++) {
            this.output += String.fromCharCode(this.debugBufferU8[i ^ 0x3]);
        }
        this.flushDebugOutput();
    }

    writeDebugBuffer32(address, value) {
        const wordIdx = address >>> 2;
        this.debugBufferU32[wordIdx] = value;
    }

    flushDebugOutput() {
        const idx = this.output.lastIndexOf('\n');
        if (idx >= 0) {
            console.log(this.output.substring(0, idx + 1));
            this.output = this.output.substring(idx + 1);
        }
    }
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
