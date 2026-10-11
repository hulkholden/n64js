import { NAudio } from './audio_naudio.js';
import { ENVELOPE_CONFIG, ENVELOPE_CONFIG_STRIDE } from './audio_naudio_constants.js';

const ENVELOPE_RIGHT_RATE_HI = ENVELOPE_CONFIG + ENVELOPE_CONFIG_STRIDE + 2;
const ENVELOPE_RIGHT_RATE_LO = ENVELOPE_RIGHT_RATE_HI + 2;

export class BanjoAudio extends NAudio {
  setVolumeTail(w0, w1) {
    // The extra dispatch instruction moves SETVOL by four bytes. Slot 14
    // still jumps to 0x12b0, now storing v0 as well as the command's low word.
    this.put16(ENVELOPE_RIGHT_RATE_HI, this.scalarV0);
    this.put16(ENVELOPE_RIGHT_RATE_LO, w1);
  }
}
