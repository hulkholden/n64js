import { NAudio } from './audio_naudio.js';
import { DMEM_LOOP_ADDRESS, ENVELOPE_CONFIG } from './audio_naudio_constants.js';

const OPCODE_MIXER_ALIAS_7 = 0x07;
const OPCODE_MIXER_ALIAS_8 = 0x08;
const ENVELOPE_LEFT_TARGET = ENVELOPE_CONFIG;
const MIXER_ALIAS_TARGETS = 0x1c581c58;
const ENVELOPE_LEFT_RATE_HI = ENVELOPE_LEFT_TARGET + 2;
const ENVELOPE_LEFT_RATE_LO = ENVELOPE_LEFT_TARGET + 4;

export class DonkeyKongAudio extends NAudio {
  envelopeSampleMask(channel, dry, wet) {
    // 0x1a98–0x1aa8 form all-one masks from the low gain bits. VXOR
    // complements samples before each channel's dry AND wet products.
    return -((channel ? wet : dry) & 1);
  }

  executeSpecial(opcode, w0, w1) {
    if (opcode === OPCODE_MIXER_ALIAS_7 || opcode === OPCODE_MIXER_ALIAS_8) {
      // SETLOOP overwrites these table entries: reject their mutable targets.
      this.require(this.view.getUint32(DMEM_LOOP_ADDRESS) === MIXER_ALIAS_TARGETS, 'NAudio mixer alias overwritten by SETLOOP');
      return this.mix(w0 & 0xffff, w1 >>> 16, w1 & 0xffff);
    }
    return super.executeSpecial(opcode, w0, w1);
  }

  setVolumeTail(w0, w1) {
    // Slot 14 wraps to SETVOL's left-channel stores at 0x12b0.
    this.put16(ENVELOPE_LEFT_TARGET, w0);
    this.put16(ENVELOPE_LEFT_RATE_HI, this.scalarV0);
    this.put16(ENVELOPE_LEFT_RATE_LO, w1);
  }
}
