// Derived from the captured naudio-standard RSP program. Banjo and DK64
// specialise only behavior that differs in their reviewed instructions.
import { AudioBase, UnsupportedAudioCommand } from './audio_base.js';
import * as constants from './audio_naudio_constants.js';
import { round8, round16, round32 } from './audio_buffer.js';
import {
  UINT16_MAX, signed16, unsigned16, clamp16,
  fixed16FromParts, fixed16ToInt, clampFixed16Hi, clampFixed16Lo, mulFraction, mixSample,
} from './audio_fixed_point.js';

const OPCODE_ADPCM = 0x01;
const OPCODE_CLEARBUFF = 0x02;
const OPCODE_ENVMIXER = 0x03;
const OPCODE_LOADBUFF = 0x04;
const OPCODE_RESAMPLE = 0x05;
const OPCODE_SAVEBUFF = 0x06;
const OPCODE_SETVOL = 0x09;
const OPCODE_DMEMMOVE = 0x0a;
const OPCODE_LOADADPCM = 0x0b;
const OPCODE_MIXER = 0x0c;
const OPCODE_INTERLEAVE = 0x0d;
const OPCODE_SETVOL_TAIL = 0x0e;
const OPCODE_SETLOOP = 0x0f;

const FLAG_INIT = 1;
const FLAG_LEFT = 2;
const FLAG_VOLUME = 4;

function createEnvelopeChannel() {
  return { target: 0, rateHi: 0, rateLo: 0, hi: new Int16Array(constants.VECTOR_SAMPLES), lo: new Uint16Array(constants.VECTOR_SAMPLES) };
}

export class NAudio extends AudioBase {
  constructor(ram, dmem) {
    super(ram, dmem);
    this.envelopeChannels = [createEnvelopeChannel(), createEnvelopeChannel()];
    this.scalarV0 = 0;
  }

  get commandBuffer() { return constants.DMEM_COMMAND_BUFFER; }
  get commandBufferSize() { return constants.COMMAND_BUFFER_SIZE; }

  initializeTask() {}

  beginCommandBatch() {
    // The command loader leaves v0 = SP_DMA_BUSY = 0. Banjo's opcode 14
    // subsequently consumes this otherwise temporary scalar register.
    this.scalarV0 = 0;
  }

  buffer(p, n, alignment = 1) {
    if (!(p >= constants.DMEM_ADPCM_BOOK && n >= 0 && p + n <= constants.DMEM_SCRATCH && p % alignment === 0)) {
      throw new UnsupportedAudioCommand(`Unreviewed NAudio buffer: ${p.toString(16)} + ${n}`);
    }
  }

  execute(w0, w1) {
    const opcode = w0 >>> 24;
    const low = unsigned16(w0);
    const flags = (w0 >>> 16) & 255;

    switch (opcode) {
      case OPCODE_ADPCM: {
        const input = constants.DMEM_SAMPLE_BUFFER + ((w1 >>> 12) & 15);
        const output = constants.DMEM_SAMPLE_BUFFER + (w1 & constants.BUFFER_OFFSET_MASK);
        const count = round32((w1 >>> 16) & constants.BUFFER_OFFSET_MASK);
        const address = w0 & constants.RAM_ADDRESS_MASK;
        this.decodeADPCM(w1 >>> 28, address, input, output, count,
          constants.DMEM_ADPCM_BOOK, constants.ADPCM_BOOK_SIZE, this.view.getUint32(constants.DMEM_LOOP_ADDRESS));
        this.scalarV0 = address;
        return;
      }

      case OPCODE_CLEARBUFF: {
        const count = Math.max(constants.VECTOR_BYTES, round16(unsigned16(w1)));
        const p = constants.DMEM_SAMPLE_BUFFER + low;
        this.buffer(p, count);
        this.dmem.fill(0, p, p + count);
        this.scalarV0 = unsigned16(w1) - count;
        return;
      }

      case OPCODE_ENVMIXER:
        this.envelope(flags, signed16(low), w1 & constants.RAM_ADDRESS_MASK);
        this.scalarV0 = w1 & constants.RAM_ADDRESS_MASK;
        return;

      case OPCODE_LOADBUFF:
      case OPCODE_SAVEBUFF: {
        const count = (w0 >>> 12) & constants.BUFFER_OFFSET_MASK;
        if (!count) return;
        const p = constants.DMEM_SAMPLE_BUFFER + (w0 & constants.BUFFER_OFFSET_MASK);
        this.buffer(p & ~7, round8(count));
        this.dma(p, w1 & constants.RAM_ADDRESS_MASK, count, opcode === OPCODE_SAVEBUFF);
        this.scalarV0 = w1 & constants.RAM_ADDRESS_MASK;
        return;
      }

      case OPCODE_RESAMPLE:
        this.resample(w0 & constants.RAM_ADDRESS_MASK, w1);
        this.scalarV0 = w0 & constants.RAM_ADDRESS_MASK;
        return;

      case OPCODE_SETVOL:
        this.setVolume(flags, low, w1);
        this.scalarV0 = w1 >>> 16;
        return;

      case OPCODE_DMEMMOVE: {
        const from = constants.DMEM_SAMPLE_BUFFER + low;
        const to = constants.DMEM_SAMPLE_BUFFER + (w1 >>> 16);
        const count = Math.max(constants.VECTOR_BYTES, round16(unsigned16(w1)));
        this.buffer(from, count);
        this.buffer(to, count);
        for (let i = 0; i < count; i += constants.VECTOR_BYTES) this.dmem.copyWithin(to + i, from + i, from + i + constants.VECTOR_BYTES);
        this.scalarV0 = from + count;
        return;
      }

      case OPCODE_LOADADPCM:
        this.require(low > 0 && low <= constants.ADPCM_BOOK_SIZE, 'Unreviewed NAudio predictor book size');
        this.dma(constants.DMEM_ADPCM_BOOK, w1 & constants.RAM_ADDRESS_MASK, low);
        this.scalarV0 = w1 & constants.RAM_ADDRESS_MASK;
        return;

      case OPCODE_MIXER: return this.mix(low, w1 >>> 16, unsigned16(w1));

      case OPCODE_INTERLEAVE:
        this.interleave();
        this.scalarV0 = constants.DMEM_DRY_LEFT + constants.MONO_BYTES;
        return;

      case OPCODE_SETVOL_TAIL: return this.setVolumeTail(w0, w1);

      case OPCODE_SETLOOP:
        this.view.setUint32(constants.DMEM_LOOP_ADDRESS, w1 & constants.RAM_ADDRESS_MASK);
        return;

      default: return this.executeSpecial(opcode, w0, w1);
    }
  }

  executeSpecial(opcode) {
    // Slot zero does not decrement the batch counter; slots 7/8 alias the
    // mutable loop pointer. None is a conventional no-op in this program.
    throw new UnsupportedAudioCommand(`Unsupported NAudio opcode ${opcode}`);
  }

  setVolume(flags, volume, w1) {
    if (flags & FLAG_VOLUME) {
      if (flags & FLAG_LEFT) {
        this.put16(constants.ENVELOPE_INITIAL_LEFT, volume);
        this.put16(constants.ENVELOPE_DRY_VOLUME, w1 >>> 16);
        this.put16(constants.ENVELOPE_WET_VOLUME, w1);
      } else {
        this.put16(constants.ENVELOPE_CONFIG + constants.ENVELOPE_CONFIG_STRIDE, volume);
        this.view.setUint32(constants.ENVELOPE_CONFIG + constants.ENVELOPE_CONFIG_STRIDE + 2, w1);
      }
    } else {
      this.put16(constants.ENVELOPE_CONFIG, volume);
      this.view.setUint32(constants.ENVELOPE_CONFIG + 2, w1);
    }
  }

  setVolumeTail(w0, w1) {
    // Slot 14 contains 0x02b0: JR wraps to IMEM 0x12b0, the final SH in
    // SETVOL's right-channel branch. The nearby pole filter is unreachable.
    this.put16(constants.ENVELOPE_CONFIG + constants.ENVELOPE_CONFIG_STRIDE + 4, w1);
  }

  mix(gain, inputOffset, outputOffset) {
    const input = constants.DMEM_SAMPLE_BUFFER + inputOffset;
    const output = constants.DMEM_SAMPLE_BUFFER + outputOffset;
    this.buffer(input, constants.MONO_BYTES, constants.VECTOR_BYTES);
    this.buffer(output, constants.MONO_BYTES, constants.VECTOR_BYTES);
    if (input !== output) this.disjoint(input, constants.MONO_BYTES, output, constants.MONO_BYTES);

    gain = signed16(gain);
    for (let p = 0; p < constants.MONO_BYTES; p += 2) {
      this.put16(output + p, mixSample(this.s16(output + p), this.s16(input + p), gain));
    }
  }

  interleave() {
    for (let p = 0; p < constants.MONO_BYTES; p += 2) {
      this.put16(constants.DMEM_SAMPLE_BUFFER + p * 2, this.s16(constants.DMEM_DRY_LEFT + p));
      this.put16(constants.DMEM_SAMPLE_BUFFER + p * 2 + 2, this.s16(constants.DMEM_DRY_RIGHT + p));
    }
  }

  resample(address, word) {
    const input = constants.DMEM_SAMPLE_BUFFER + ((word >>> 2) & constants.BUFFER_OFFSET_MASK);
    const output = word & 3 ? constants.DMEM_SECOND_BUFFER : constants.DMEM_SAMPLE_BUFFER;
    const pitch = (word >>> 14) & UINT16_MAX;
    const initialize = (word >>> 30) !== 0;
    if (!initialize) this.dma(constants.DMEM_SCRATCH, address, constants.RESAMPLE_STATE_SIZE);

    let source = input - constants.RESAMPLE_HISTORY_SIZE;
    this.buffer(source, constants.RESAMPLE_HISTORY_SIZE, 2);
    if (initialize) this.dmem.fill(0, source, input);
    else this.dmem.copyWithin(source, constants.DMEM_SCRATCH, constants.RESAMPLE_PHASE);
    let phase = initialize ? 0 : this.u16(constants.RESAMPLE_PHASE);

    for (let p = 0; p < constants.MONO_BYTES; p += constants.VECTOR_BYTES) {
      // The RSP gathers all eight windows before storing their outputs.
      for (let lane = 0; lane < constants.VECTOR_SAMPLES; lane++) {
        this.buffer(source, constants.RESAMPLE_HISTORY_SIZE, 2);
        const table = constants.DMEM_RESAMPLE_TABLE + (phase >>> constants.RESAMPLE_PHASE_SHIFT) * constants.RESAMPLE_TABLE_STRIDE;
        const a = mulFraction(this.s16(source), this.s16(table));
        const b = mulFraction(this.s16(source + 2), this.s16(table + 2));
        const c = mulFraction(this.s16(source + 4), this.s16(table + 4));
        const d = mulFraction(this.s16(source + 6), this.s16(table + 6));
        this.result[lane] = clamp16(clamp16(a + b) + clamp16(c + d));
        phase += pitch * 2;
        source += (phase >>> 16) * 2;
        phase = unsigned16(phase);
      }
      for (let lane = 0; lane < constants.VECTOR_SAMPLES; lane++) this.put16(output + p + lane * 2, this.result[lane]);
    }

    this.buffer(source, constants.RESAMPLE_HISTORY_SIZE, 2);
    this.dmem.copyWithin(constants.DMEM_SCRATCH, source, source + constants.RESAMPLE_HISTORY_SIZE);
    this.put16(constants.RESAMPLE_PHASE, phase);
    // Bytes 10..15 are not written by the handler, but are still DMA'd back.
    this.dma(constants.DMEM_SCRATCH, address, constants.RESAMPLE_STATE_SIZE, true);
  }

  envelope(flags, initialRight, address) {
    const initialize = (flags & FLAG_INIT) !== 0;
    if (!initialize) this.dma(constants.DMEM_SCRATCH, address, constants.ENVELOPE_STATE_SIZE);
    const dry = this.s16(constants.ENVELOPE_DRY_VOLUME), wet = this.s16(constants.ENVELOPE_WET_VOLUME);
    const channels = this.envelopeChannels;

    for (let channel = 0; channel < 2; channel++) {
      const c = channels[channel];
      const config = constants.ENVELOPE_CONFIG + channel * constants.ENVELOPE_CONFIG_STRIDE;
      c.target = this.s16(config);
      c.rateHi = this.s16(config + 2);
      c.rateLo = this.u16(config + 4);
      const initial = channel ? initialRight : this.s16(constants.ENVELOPE_INITIAL_LEFT);
      for (let lane = 0; lane < constants.VECTOR_SAMPLES; lane++) {
        if (initialize) {
          const weight = lane === constants.VECTOR_SAMPLES - 1 ? UINT16_MAX : (lane + 1) * constants.ENVELOPE_WEIGHT_STEP;
          const value = fixed16FromParts(initial, 0) + fixed16ToInt(fixed16FromParts(c.rateHi, c.rateLo) * weight);
          c.hi[lane] = clampFixed16Hi(value);
          c.lo[lane] = clampFixed16Lo(value);
        } else {
          const state = constants.DMEM_SCRATCH + channel * constants.ENVELOPE_CHANNEL_SIZE + lane * 2;
          c.hi[lane] = this.s16(state);
          c.lo[lane] = this.u16(state + constants.VECTOR_BYTES);
        }
      }
    }

    for (let p = 0; p < constants.MONO_BYTES; p += constants.VECTOR_BYTES) {
      for (let channel = 0; channel < 2; channel++) {
        const c = channels[channel];
        const dryOutput = channel ? constants.DMEM_DRY_RIGHT : constants.DMEM_DRY_LEFT;
        const wetOutput = channel ? constants.DMEM_WET_RIGHT : constants.DMEM_WET_LEFT;
        const mask = this.envelopeSampleMask(channel, dry, wet);
        for (let lane = 0; lane < constants.VECTOR_SAMPLES; lane++) {
          if (!initialize || p > 0) {
            const fraction = c.lo[lane] + c.rateLo;
            c.hi[lane] = clamp16(c.hi[lane] + c.rateHi + (fraction >>> 16));
            c.lo[lane] = unsigned16(fraction);
          }
          c.hi[lane] = c.rateHi >= 0 ? Math.min(c.hi[lane], c.target) : Math.max(c.hi[lane], c.target);
          const offset = p + lane * 2;
          const sample = this.s16(constants.DMEM_SAMPLE_BUFFER + offset) ^ mask;
          this.put16(dryOutput + offset, mixSample(this.s16(dryOutput + offset), sample, mulFraction(c.hi[lane], dry)));
          this.put16(wetOutput + offset, mixSample(this.s16(wetOutput + offset), sample, mulFraction(c.hi[lane], wet)));
        }
      }
    }

    for (let channel = 0; channel < 2; channel++) {
      const c = channels[channel];
      for (let lane = 0; lane < constants.VECTOR_SAMPLES; lane++) {
        const state = constants.DMEM_SCRATCH + channel * constants.ENVELOPE_CHANNEL_SIZE + lane * 2;
        this.put16(state, c.hi[lane]);
        this.put16(state + constants.VECTOR_BYTES, c.lo[lane]);
      }
    }
    this.dma(constants.DMEM_SCRATCH, address, constants.ENVELOPE_STATE_SIZE, true);
  }

  envelopeSampleMask() { return 0; }
}
