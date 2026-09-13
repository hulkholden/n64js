import { toString32 } from '../format.js';

// Empty SmartMedia slots, based on LuigiBlood's documented mapper:
// https://github.com/LuigiBlood/EmuScripts/blob/bab9e07e031eb57b3f2dbfe31181ded9cc5b3850/N64/Project64_JSAPI2/SmartMedia_CartMapper.js
// This is a reference-compatible startup model, not hardware-verified timing or
// authentication. See docs/photopie.md for the supported protocol and limits.
export class Photopie {
  constructor() {
    this.slots = [0xfff0, 0xc000].map(seed => ({
      seed,
      responseLow: 0,
      responseHigh: 0,
      unlock: 0,
    }));
  }

  handlesAddress(address) {
    return address >= 0xafe70100 && address < 0xafe70180;
  }

  readU32(address) {
    const slot = this.slots[(address - 0xafe70100) >>> 6];
    switch (address & 0x3f) {
      // The reference's default status (0x43), with EMPTY (0x04) set.
      case 0x00: return 0x47;
      // CARD_PRESENT (0x04) is clear. No media is attached to either slot.
      case 0x04: return 0;
      case 0x08: return 0xff;
      // Seed reads and response writes use separate latches.
      case 0x20: return slot.seed & 0xff;
      case 0x24: return slot.seed >>> 8;
      default:
        throw `Photopie: unsupported no-media read [${toString32(address)}]`;
    }
  }

  write32(address, value) {
    const slot = this.slots[(address - 0xafe70100) >>> 6];
    switch (address & 0x3f) {
      // The reference records these writes without validating authentication
      // or changing status. Do not invent an acknowledgement or busy period.
      case 0x20: slot.responseLow = value >>> 0; return;
      case 0x24: slot.responseHigh = value >>> 0; return;
      case 0x3c: slot.unlock = value >>> 0; return;
      default:
        throw `Photopie: unsupported no-media write ${toString32(value)} -> [${toString32(address)}]`;
    }
  }
}
