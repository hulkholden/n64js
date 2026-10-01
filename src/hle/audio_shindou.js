import { NEADAudio } from './audio_nead.js';
import { unsigned16 } from './audio_fixed_point.js';
import * as nead from './audio_nead_constants.js';

// Shindou uses packed INTERLEAVE lengths and replaces POLEF with a FIR filter.
export class ShindouAudio extends NEADAudio {
  execute(w0, w1) {
    switch (w0 >>> 24) {
      case nead.OPCODE_INTERLEAVE:
        this.envelopeReady = 0;
        this.filterCount = 0;
        return this.interleave(w1 >>> 16, unsigned16(w1), unsigned16(w0), Math.max(nead.RESAMPLE_NEAREST_BYTES, (w0 >>> 12) & nead.PACKED_BUFFER_MASK), nead.RESAMPLE_NEAREST_LANES);
      case nead.OPCODE_POLEF: return;
      case nead.OPCODE_FIR_FILTER:
        this.envelopeReady = 0;
        return this.firFilter(w0, w1);
      default: return super.execute(w0, w1);
    }
  }
}

// Wave Race uses slot three for an additional multiply command.
export class WaveRaceAudio extends ShindouAudio {
  execute(w0, w1) {
    this.require(w0 >>> 24 !== nead.OPCODE_RESERVED_03, 'Unreviewed Wave Race multiply command');
    return super.execute(w0, w1);
  }
}
