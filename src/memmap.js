
import { toString32 } from './format.js';
import * as logger from './logger.js';

export class MemoryMap {
  constructor(devices) {
    this.map = this.createMemMap(devices);
  }

  createMemMap(devices) {
    const map = [];
    for (let i = 0; i < 0x4000; ++i) {
      map.push(undefined);
    }

    // We create a memory map of 1<<14 entries, corresponding to the top bits of the address range.
    devices.map(e => {
      const beg = (e.rangeStart) >>> 18;
      const end = (e.rangeEnd - 1) >>> 18;
      for (let i = beg; i <= end; ++i) {
        map[i] = e;
      }
    });

    if (map.length !== 0x4000) {
      throw 'initialisation error';
    }

    return map;
  }

  getMemoryHandler(address) {
    //assert(address>=0, "Address is negative");
    const handler = this.map[address >>> 18];
    if (handler) {
      return handler;
    }

    logger.log(`accessing unhandled location ${toString32(address)}`);
    throw `unhandled access ${toString32(address)}`;
  }

  // Read/Write memory internal is used for stuff like the debugger
  // It shouldn't ever throw or change the state of the emulated program.
  readMemoryInternal32(address) {
    const handler = this.map[address >>> 18];
    if (handler) {
      return handler.readInternal32(address);
    }
    return 0xdddddddd;
  }

  writeMemoryInternal32(address, value) {
    const handler = this.map[address >>> 18];
    if (handler) {
      handler.writeInternal32(address, value);
    }
  }
}
