import { NEADAudio } from './audio_nead.js';
import * as nead from './audio_nead_constants.js';

// Mario Kart predates absolute buffer addresses and two-vector envelope ramps.
const DMEM_SEGMENT_TABLE = 0x320;
const DMEM_PARAMS = 0x330;
const DMEM_COMMAND_BUFFER = 0x350;
const DMEM_ADPCM_BOOK = 0x3d0;
const DMEM_SAMPLE_BUFFER = 0x450;
const DMEM_SCRATCH = 0xfa0;
const DMEM_RESAMPLE_TABLE = 0x100;
const OPCODE_SEGMENT = 7;
const SEGMENT_COUNT = (DMEM_PARAMS - DMEM_SEGMENT_TABLE) / 4;
const FLAG_AUXILIARY_BUFFERS = 8;
const PARAM_OUTPUT_RIGHT = 0x0a;
const PARAM_WET_LEFT = 0x0c;
const PARAM_WET_RIGHT = 0x0e;

export class MarioKartAudio extends NEADAudio {
  get parameters() { return DMEM_PARAMS; }
  get commandBuffer() { return DMEM_COMMAND_BUFFER; }
  get book() { return DMEM_ADPCM_BOOK; }
  get bookSize() { return DMEM_SAMPLE_BUFFER - DMEM_ADPCM_BOOK; }
  get scratch() { return DMEM_SCRATCH; }
  get resampleTable() { return DMEM_RESAMPLE_TABLE; }
  get expandedResampleHistory() { return false; }
  get bufferBase() { return DMEM_SAMPLE_BUFFER; }
  get envelopeBlockSamples() { return nead.VECTOR_SAMPLES; }

  initializeTask(rsp) {
    super.initializeTask(rsp);
    // The loader repeatedly writes the same word, clearing only segment zero.
    this.view.setUint32(DMEM_SEGMENT_TABLE, 0);
  }

  address(w) {
    this.require((w >>> 24) < SEGMENT_COUNT, 'Mario Kart segment aliases parameters');
    return ((w & nead.RAM_ADDRESS_MASK) + this.view.getUint32(DMEM_SEGMENT_TABLE + (w >>> 24) * 4)) & nead.RAM_ADDRESS_MASK;
  }

  execute(w0, w1) {
    const opcode = w0 >>> 24;
    if (opcode === OPCODE_SEGMENT) {
      this.require((w1 >>> 24) < SEGMENT_COUNT, 'Mario Kart segment aliases parameters');
      this.view.setUint32(DMEM_SEGMENT_TABLE + (w1 >>> 24) * 4, w1 & nead.RAM_ADDRESS_MASK);
      return;
    }

    if (opcode === nead.OPCODE_SETBUFF && ((w0 >>> 16) & FLAG_AUXILIARY_BUFFERS)) {
      this.put16(this.parameters + PARAM_OUTPUT_RIGHT, w0 + this.bufferBase);
      this.put16(this.parameters + PARAM_WET_LEFT, (w1 >>> 16) + this.bufferBase);
      this.put16(this.parameters + PARAM_WET_RIGHT, w1 + this.bufferBase);
      return;
    }

    if (opcode === nead.OPCODE_ADDMIXER || opcode === nead.OPCODE_RESAMPLE_NEAREST || opcode >= nead.OPCODE_PCM8 && opcode <= nead.OPCODE_RESERVED_1F) {
      return;
    }
    return super.execute(w0, w1);
  }

  setupEnvelope1(w0, w1) {
    super.setupEnvelope1(w0, w1);
    this.envelopeRates[2] = 0;
  }

  envelopeSwap() { return false; }
}
