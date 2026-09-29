import { NEADAudio } from './audio_nead.js';
import { unsigned16 } from './audio_fixed_point.js';
import * as C from './audio_nead_constants.js';

// Shindou uses packed INTERLEAVE lengths and replaces POLEF with a FIR filter.
export class ShindouAudio extends NEADAudio {
  execute(w0, w1) {
    switch (w0 >>> 24) {
      case C.OPCODE_INTERLEAVE:
        this.envelopeReady = 0;
        this.filterCount = 0;
        return this.interleave(w1 >>> 16, unsigned16(w1), unsigned16(w0), Math.max(C.RESAMPLE_NEAREST_BYTES, (w0 >>> 12) & C.PACKED_BUFFER_MASK), C.RESAMPLE_NEAREST_LANES);
      case C.OPCODE_POLEF: return;
      case C.OPCODE_FIR_FILTER:
        this.envelopeReady = 0;
        return this.firFilter(w0, w1);
      default: return super.execute(w0, w1);
    }
  }
}

// Wave Race uses slot three for an additional multiply command.
export class WaveRaceAudio extends ShindouAudio {
  execute(w0, w1) {
    this.require(w0 >>> 24 !== C.OPCODE_RESERVED_03, 'Unreviewed Wave Race multiply command');
    return super.execute(w0, w1);
  }
}
