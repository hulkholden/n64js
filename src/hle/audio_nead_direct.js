import { SP_DMEM_SIZE } from '../devices/sp_constants.js';
import { TASK_OFFSET, TaskOffsets } from './rsp_task_constants.js';
import { ShindouAudio } from './audio_shindou.js';
import { round2, round32 } from './audio_buffer.js';
import * as nead from './audio_nead_constants.js';

// Yoshi/1080 load directly at IMEM zero, use shorter command batches and
// support two-bit ADPCM. Later Zelda programs move the book and saved state.
const DMEM_PARAMS = 0x2e0;
const DMEM_COMMAND_BUFFER = 0x300;
const COMMAND_BUFFER_SIZE = 0x40;
const DMEM_ADPCM_BOOK = 0x340;
const DMEM_RESAMPLE_TABLE = 0xe0;
const DMEM_SCRATCH = 0xfc0;
const FLAG_TWO_BIT_ADPCM = 4;
const PARAM_DRAM_STACK = 0x0c;
const COMMAND_BYTES = 8;
const OPCODE_DUPLICATE = nead.OPCODE_RESERVED_09;
const OPCODE_GAIN = nead.OPCODE_POLEF;

export class NEADDirectAudio extends ShindouAudio {
  get bufferEnd() { return SP_DMEM_SIZE; }
  get parameters() { return DMEM_PARAMS; }
  get commandBuffer() { return DMEM_COMMAND_BUFFER; }
  get commandBufferSize() { return COMMAND_BUFFER_SIZE; }
  get book() { return DMEM_ADPCM_BOOK; }
  get scratch() { return DMEM_SCRATCH; }
  get resampleTable() { return DMEM_RESAMPLE_TABLE; }

  execute(w0, w1) {
    const opcode = w0 >>> 24;
    if (opcode === nead.OPCODE_ADPCM) {
      this.filterCount = 0;
      this.envelopeReady = 0;
      this.loadVector31(0);
      return this.decodeADPCM((w0 >>> 16) & 255, this.address(w1), this.input, this.output, round32(this.count),
        this.book, this.bookSize, (w0 >>> 16) & nead.FLAG_LOOP ? this.loopAddress : 0, (w0 >>> 16) & FLAG_TWO_BIT_ADPCM ? 2 : 4);
    }

    if (opcode === nead.OPCODE_FILTER) {
      this.envelopeReady = 0;
      return this.firFilter(w0, w1);
    }

    if (opcode === OPCODE_GAIN || opcode === OPCODE_DUPLICATE) {
      this.envelopeReady = 0;
      this.filterCount = 0;
      if (opcode === OPCODE_GAIN) return this.gain((w0 >>> 16) & 255, w0 & 0xffff, w1 >>> 16);
      return this.duplicate(w0 & 0xffff, w1 >>> 16, Math.max(1, (w0 >>> 16) & 255));
    }

    this.require(opcode !== nead.OPCODE_NOOP && opcode !== nead.OPCODE_RESERVED_03 && opcode < nead.OPCODE_GAIN, 'Unreviewed direct NEAD command');
    return super.execute(w0, w1);
  }
}

// 1080 adds distinct wet-bus complements and moves the wet-channel swap bit.
export class SnowboardingAudio extends NEADDirectAudio {
  envelopeWetMask(w0, channel) { return -((w0 & (channel ? 4 : 8)) >>> 1) | 0; }
  envelopeSwap(w0) { return (w0 & 16) !== 0; }
}

const ZELDA_COMMAND_BUFFER = 0x2f0;
const ZELDA_ADPCM_BOOK = 0x330;
const ZELDA_SCRATCH = 0xfb0;
const ZELDA_LOOP_PARAMETER = 8;

export class OcarinaAudio extends SnowboardingAudio {
  get commandBuffer() { return ZELDA_COMMAND_BUFFER; }
  get book() { return ZELDA_ADPCM_BOOK; }
  get scratch() { return ZELDA_SCRATCH; }
  get loopParameter() { return ZELDA_LOOP_PARAMETER; }
  get filterStateSize() { return nead.VECTOR_BYTES * 2; }

  moveExact(from, to, count) {
    this.buffer(from, round2(count), nead.SAMPLE_BYTES);
    this.buffer(to, round2(count), nead.SAMPLE_BYTES);
    const body = count & ~(nead.VECTOR_BYTES - 1);
    for (let p = 0; p < body; p += nead.VECTOR_BYTES) this.dmem.copyWithin(to + p, from + p, from + p + nead.VECTOR_BYTES);
    for (let p = body; p < count; p += nead.SAMPLE_BYTES) this.put16(to + p, this.s16(from + p));
  }
}

// Majora keeps a task stack pointer and copies the final move halfwords exactly.
export class MajoraAudio extends OcarinaAudio {
  initializeTask(rsp) {
    super.initializeTask(rsp);
    this.view.setUint32(this.parameters + PARAM_DRAM_STACK, this.view.getUint32(TASK_OFFSET + TaskOffsets.dramStackPtr));
  }

  execute(w0, w1) {
    if (w0 >>> 24 === nead.OPCODE_DMEMMOVE) {
      this.envelopeReady = 0;
      this.filterCount = 0;
      return this.moveExact(w0 & 0xffff, w1 >>> 16, Math.max(nead.SAMPLE_BYTES, w1 & 0xffff));
    }

    if (w0 >>> 24 === nead.OPCODE_RESERVED_03) return;
    return super.execute(w0, w1);
  }
}

// Animal Forest fetches one command at a time and skips zero-length moves.
export class AnimalForestAudio extends MajoraAudio {
  get book() { return DMEM_COMMAND_BUFFER; }
  get commandBufferSize() { return COMMAND_BYTES; }

  execute(w0, w1) {
    if (w0 >>> 24 === nead.OPCODE_DMEMMOVE) {
      this.envelopeReady = 0;
      this.filterCount = 0;
      return this.moveExact(w0 & 0xffff, w1 >>> 16, (w1 & 0xffff));
    }

    if (w0 >>> 24 === nead.OPCODE_RESERVED_03) return;
    return super.execute(w0, w1);
  }
}

// F-Zero keeps four-bit ADPCM and has a dry-only envelope fast path.
export class FZeroAudio extends NEADDirectAudio {
  envelopeDryMask() { return 0; }
  get envelopeWetEnabled() { return this.envelopeVolumes[5] !== 0; }

  envelope(w0, w1) {
    // The wet-path test overwrites the scalar increment register with V1[5].
    const nextWetRate = this.envelopeVolumes[5];
    super.envelope(w0, w1);
    this.envelopeRates[2] = nextWetRate;
  }

  execute(w0, w1) {
    const opcode = w0 >>> 24;
    if (opcode === nead.OPCODE_ADPCM) {
      this.loadVector31(0);
      this.envelopeReady = 0;
      return this.decodeADPCM(w0 >>> 16, this.address(w1), this.input, this.output, round32(this.count), this.book, this.bookSize, (w0 >>> 16) & nead.FLAG_LOOP ? this.loopAddress : 0);
    }

    if (opcode === nead.OPCODE_RESERVED_03 || opcode === nead.OPCODE_FILTER || opcode === nead.OPCODE_RESAMPLE_NEAREST || opcode === nead.OPCODE_RESERVED_09 || opcode === nead.OPCODE_POLEF) return;
    return super.execute(w0, w1);
  }
}
