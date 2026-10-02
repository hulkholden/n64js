// Derived from captured ABI1 RSP programs, not another audio HLE.
// Variants share handlers only where the reviewed instructions agree.
import { AudioBase, UnsupportedAudioCommand } from './audio_base.js';
import { round8, round16, round32 } from './audio_buffer.js';
import {
  FIXED16_ONE, UINT16_MAX, clamp16, signed16, unsigned16,
  fixed16FromParts, fixed16ToInt, clampFixed16Hi, clampFixed16Lo,
  mulFixed16, mulFraction, mixSample,
} from './audio_fixed_point.js';

const OPCODE_SPNOOP = 0x00;
const OPCODE_ADPCM = 0x01;
const OPCODE_CLEARBUFF = 0x02;
const OPCODE_ENVMIXER = 0x03;
const OPCODE_LOADBUFF = 0x04;
const OPCODE_RESAMPLE = 0x05;
const OPCODE_SAVEBUFF = 0x06;
const OPCODE_SEGMENT = 0x07;
const OPCODE_SETBUFF = 0x08;
const OPCODE_SETVOL = 0x09;
const OPCODE_DMEMMOVE = 0x0a;
const OPCODE_LOADADPCM = 0x0b;
const OPCODE_MIXER = 0x0c;
const OPCODE_INTERLEAVE = 0x0d;
const OPCODE_POLEF = 0x0e;
const OPCODE_SETLOOP = 0x0f;

// DMEM layout shared by the reviewed ABI1 programs. The task loader uses the
// same segment table and command buffer as the individual command handlers.
const DMEM_RESAMPLE_TABLE = 0x0c0;
const DMEM_SEGMENT_TABLE = 0x320;
const DMEM_PARAMS = 0x360;
const DMEM_COMMAND_BUFFER = 0x380;
const COMMAND_BUFFER_SIZE = 0x140;
const DMEM_ADPCM_BOOK = 0x4c0;
const ADPCM_BOOK_SIZE = 0x100;
const DMEM_SAMPLE_BUFFER = 0x5c0;
const DMEM_SCRATCH = 0xf90;

// Commands add a DMEM segment base to their low 24 address bits.
const SEGMENT_COUNT = 16;
const SEGMENT_ENTRY_BYTES = 4;
const RAM_ADDRESS_MASK = 0x00ffffff;

const PARAM_INPUT = DMEM_PARAMS;
const PARAM_OUTPUT = DMEM_PARAMS + 0x02;
const PARAM_COUNT = DMEM_PARAMS + 0x04;
const PARAM_VOLUME_LEFT = DMEM_PARAMS + 0x06;
const PARAM_VOLUME_RIGHT = DMEM_PARAMS + 0x08;
const PARAM_OUTPUT_RIGHT = DMEM_PARAMS + 0x0a;
const PARAM_WET_OUTPUT_LEFT = DMEM_PARAMS + 0x0c;
const PARAM_WET_OUTPUT_RIGHT = DMEM_PARAMS + 0x0e;
const PARAM_ENVELOPE_LEFT = DMEM_PARAMS + 0x10;
const PARAM_ENVELOPE_RIGHT = DMEM_PARAMS + 0x16;
const PARAM_DRY_VOLUME = DMEM_PARAMS + 0x1c;
const PARAM_WET_VOLUME = DMEM_PARAMS + 0x1e;

// SETLOOP aliases the left envelope configuration; it has no separate slot.
const PARAM_LOOP_ADDRESS = PARAM_ENVELOPE_LEFT;

const ENVELOPE_SAVED_CONFIG = DMEM_SCRATCH + 0x40;
// Four volume vectors (integer/fractional for each channel) plus configuration.
const ENVELOPE_STATE_SIZE = 5 * 16;
const ENVELOPE_WEIGHT_STEP = FIXED16_ONE / 8;
const ENVELOPE_WEIGHT_MAX = UINT16_MAX;

function createEnvelopeChannel() {
  return { target: 0, rateHi: 0, rateLo: 0, hi: new Int16Array(8), lo: new Uint16Array(8) };
}

function initializeEnvelopeChannel(channel, initial) {
  const product = initial * fixed16FromParts(channel.rateHi, channel.rateLo);
  const productHi = clampFixed16Hi(product);
  const productLo = clampFixed16Lo(product);

  const difference = fixed16FromParts(clamp16(productHi - initial), productLo);
  const initialFixed = fixed16FromParts(initial, 0);

  for (let lane = 0; lane < 8; lane++) {
    const weight = lane === 7 ? ENVELOPE_WEIGHT_MAX : (lane + 1) * ENVELOPE_WEIGHT_STEP;
    const value = initialFixed + fixed16ToInt(difference * weight);
    channel.hi[lane] = clampFixed16Hi(value);
    // Interpolation wraps the low word; only the rate product above saturates it.
    channel.lo[lane] = unsigned16(value);
  }
}

/** Private working DMEM; RDRAM writes are journalled for atomic LLE fallback.
 * The default commands implement abi1-standard-mixer. Derived classes override
 * the handlers that differ in their reviewed program; dispatch stays shared.
 * Instances and their scratch arrays can be reused between synchronous tasks.
 */
export class ABI1Audio extends AudioBase {
  constructor(ram, dmem) {
    super(ram, dmem);
    this.envelopeOutputs = new Uint16Array(4);
    this.envelopeChannels = [createEnvelopeChannel(), createEnvelopeChannel()];
  }

  get commandBuffer() { return DMEM_COMMAND_BUFFER; }
  get commandBufferSize() { return COMMAND_BUFFER_SIZE; }

  initializeTask() {
    // 0x10c0–0x10d0 repeatedly stores at the SAME address: segment zero.
    this.view.setUint32(DMEM_SEGMENT_TABLE, 0);
  }

  beginCommandBatch() {}

  get input() { return this.u16(PARAM_INPUT); }
  get output() { return this.u16(PARAM_OUTPUT); }
  get count() { return this.u16(PARAM_COUNT); }
  get resampleTable() { return DMEM_RESAMPLE_TABLE; }

  buffer(p, n, alignment = 1) {
    // This guard also runs for every resampler output sample. Format the
    // diagnostic only on failure, rather than allocating a string per sample.
    if (!(p >= DMEM_ADPCM_BOOK && n >= 0 && p + n <= DMEM_SCRATCH && p % alignment === 0)) {
      throw new UnsupportedAudioCommand(`Unreviewed audio buffer: ${p.toString(16)} + ${n}`);
    }
  }

  address(w) {
    return this.segmentAddress(w) & RAM_ADDRESS_MASK;
  }

  segmentAddress(w) {
    // The RSP indexes with the entire high byte, even beyond the 16 segment
    // entries. Aidyn's 0x80 pointers read a base from the predictor book.
    const base = this.view.getInt32(DMEM_SEGMENT_TABLE + (w >>> 24) * SEGMENT_ENTRY_BYTES);
    return ((w & RAM_ADDRESS_MASK) + base) | 0;
  }

  execute(w0, w1) {
    const opcode = w0 >>> 24;
    const flags = (w0 >>> 16) & 255;
    const low = w0 & 0xffff;

    switch (opcode) {
      case OPCODE_SPNOOP: return;

      case OPCODE_ADPCM: return this.adpcm(flags, this.address(w1));

      case OPCODE_CLEARBUFF: {
        const p = DMEM_SAMPLE_BUFFER + low, count = round16(w1 & 0xffff);
        this.buffer(p, count);
        this.dmem.fill(0, p, p + count);
        return;
      }

      case OPCODE_ENVMIXER: return this.envelope(flags, this.address(w1));

      case OPCODE_LOADBUFF:
      case OPCODE_SAVEBUFF: {
        if (!this.count) return;

        const p = opcode === OPCODE_LOADBUFF ? this.input : this.output;
        this.buffer(p & ~7, round8(this.count));
        this.dma(p, this.address(w1), this.count, opcode === OPCODE_SAVEBUFF);
        return;
      }

      case OPCODE_RESAMPLE: return this.resample(flags, low, this.address(w1));

      case OPCODE_SEGMENT:
        this.require((w1 >>> 24) < SEGMENT_COUNT, 'Audio segment outside table');
        this.view.setUint32(DMEM_SEGMENT_TABLE + (w1 >>> 24) * SEGMENT_ENTRY_BYTES, w1 & RAM_ADDRESS_MASK);
        return;

      case OPCODE_SETBUFF:
        if (flags & 8) {
          this.put16(PARAM_OUTPUT_RIGHT, low + DMEM_SAMPLE_BUFFER);
          this.put16(PARAM_WET_OUTPUT_LEFT, (w1 >>> 16) + DMEM_SAMPLE_BUFFER);
          this.put16(PARAM_WET_OUTPUT_RIGHT, (w1 & 0xffff) + DMEM_SAMPLE_BUFFER);
        } else {
          this.put16(PARAM_INPUT, low + DMEM_SAMPLE_BUFFER);
          this.put16(PARAM_OUTPUT, (w1 >>> 16) + DMEM_SAMPLE_BUFFER);
          this.put16(PARAM_COUNT, w1);
        }
        return;

      case OPCODE_SETVOL:
        if (flags & 8) {
          this.put16(PARAM_DRY_VOLUME, low);
          this.put16(PARAM_WET_VOLUME, w1);
        } else if (flags & 4) {
          this.put16(flags & 2 ? PARAM_VOLUME_LEFT : PARAM_VOLUME_RIGHT, low);
        } else {
          const p = flags & 2 ? PARAM_ENVELOPE_LEFT : PARAM_ENVELOPE_RIGHT;
          this.put16(p, low);
          this.view.setUint32(p + 2, w1);
        }
        return;

      case OPCODE_DMEMMOVE: {
        const from = DMEM_SAMPLE_BUFFER + low, to = DMEM_SAMPLE_BUFFER + (w1 >>> 16), count = round16(w1 & 0xffff);
        this.buffer(from, count);
        this.buffer(to, count);

        // 0x1424: load both halves before storing, then move forward 16 bytes.
        for (let i = 0; i < count; i += 16) this.dmem.copyWithin(to + i, from + i, from + i + 16);
        return;
      }

      case OPCODE_LOADADPCM:
        this.require(low > 0 && low <= ADPCM_BOOK_SIZE, 'Unreviewed predictor book size');
        this.dma(DMEM_ADPCM_BOOK, this.address(w1), low);
        return;

      case OPCODE_MIXER: return this.mix(low, w1 >>> 16, w1 & 0xffff);

      case OPCODE_INTERLEAVE: {
        const left = DMEM_SAMPLE_BUFFER + (w1 >>> 16), right = DMEM_SAMPLE_BUFFER + (w1 & 0xffff);
        const count = round16(this.count), out = this.output;
        this.buffer(left, count, 16);
        this.buffer(right, count, 16);
        this.buffer(out, count * 2, 2);

        const samples = this.samples;
        for (let i = 0; i < count; i += 16) {
          // Stage both vectors before writing, including overlapping outputs.
          for (let j = 0; j < 8; j++) {
            samples[j] = this.s16(left + i + j * 2);
            samples[j + 8] = this.s16(right + i + j * 2);
          }

          for (let j = 0; j < 8; j++) {
            this.put16(out + i * 2 + j * 4, samples[j]);
            this.put16(out + i * 2 + j * 4 + 2, samples[j + 8]);
          }
        }
        return;
      }

      case OPCODE_POLEF: return this.poleFilter(flags, low, this.address(w1));

      case OPCODE_SETLOOP:
        // SETLOOP stores the full sum; only a subsequent DMA masks it.
        this.view.setInt32(PARAM_LOOP_ADDRESS, this.segmentAddress(w1));
        return;

      default: throw new UnsupportedAudioCommand(`Unsupported audio opcode ${opcode}`);
    }
  }

  mix(gain, inputOffset, outputOffset) {
    if (!this.count) return;

    const count = round32(this.count);
    const input = DMEM_SAMPLE_BUFFER + inputOffset, output = DMEM_SAMPLE_BUFFER + outputOffset;
    this.buffer(input, count, 16);
    this.buffer(output, count, 16);
    if (input !== output) this.disjoint(input, count, output, count);

    gain = signed16(gain);
    for (let p = 0; p < count; p += 32) {
      // Input/output are identical or disjoint, so lane reads are independent.
      // 0x1e4c–0x1e58 preload two vectors from each buffer. VMULF retains
      // the rounded destination product in the accumulator; VMACF adds the
      // source product before the combined result is shifted and saturated.
      for (let i = 0; i < 16; i++) {
        const source = this.s16(input + p + i * 2), destination = this.s16(output + p + i * 2);
        this.put16(output + p + i * 2, mixSample(destination, source, gain));
      }
    }
  }

  poleFilter(flags, gain, address) {
    this.filterPole(flags, gain, address, this.input, this.output, round16(this.count), DMEM_ADPCM_BOOK, DMEM_SCRATCH);
  }

  adpcm(flags, address) {
    this.decodeADPCM(flags, address, this.input, this.output, round32(this.count),
      DMEM_ADPCM_BOOK, ADPCM_BOOK_SIZE, this.view.getUint32(PARAM_LOOP_ADDRESS));
  }

  resample(flags, pitch, address) {
    this.resamplePolyphase(flags, pitch, address, this.input, this.output, round16(this.count), this.resampleTable, DMEM_SCRATCH);
  }

  envelope(flags, address) {
    const count = round16(this.count), input = this.input;
    const auxiliary = (flags & 8) !== 0;
    const outputs = this.envelopeOutputs, outputCount = auxiliary ? 4 : 2;
    outputs[0] = this.output; outputs[1] = this.u16(PARAM_OUTPUT_RIGHT);
    if (auxiliary) {
      outputs[2] = this.u16(PARAM_WET_OUTPUT_LEFT); outputs[3] = this.u16(PARAM_WET_OUTPUT_RIGHT);
    }

    this.require(count >= (flags & 1 ? 32 : 16), 'Unreviewed short envelope');
    this.buffer(input, count, 16);
    for (let i = 0; i < outputCount; i++) this.buffer(outputs[i], count, 16);
    for (let i = 0; i < outputCount; i++) {
      this.disjoint(input, count, outputs[i], count);
      for (let j = i + 1; j < outputCount; j++) this.disjoint(outputs[i], count, outputs[j], count);
    }

    if (!(flags & 1)) this.dma(DMEM_SCRATCH, address, ENVELOPE_STATE_SIZE);
    const config = flags & 1 ? PARAM_ENVELOPE_LEFT : ENVELOPE_SAVED_CONFIG;
    const dry = this.s16(config + 12), wet = this.s16(config + 14);

    const channels = this.envelopeChannels;
    for (let channel = 0; channel < 2; channel++) {
      const p = config + channel * 6;
      const c = channels[channel], hi = c.hi, lo = c.lo;
      c.target = this.s16(p); c.rateHi = this.s16(p + 2); c.rateLo = this.u16(p + 4);

      if (flags & 1) {
        this.initializeEnvelope(c, this.s16(PARAM_VOLUME_LEFT + channel * 2));
      } else {
        for (let lane = 0; lane < 8; lane++) {
          hi[lane] = this.s16(DMEM_SCRATCH + channel * 32 + lane * 2);
          lo[lane] = this.u16(DMEM_SCRATCH + channel * 32 + 16 + lane * 2);
        }
      }
    }

    for (let p = 0; p < count; p += 16) {
      for (let channel = 0; channel < 2; channel++) {
        const c = channels[channel];
        if (!(flags & 1) || p > 0) this.advanceEnvelope(c);
        for (let lane = 0; lane < 8; lane++) {
          // Positive high word: VCL with cleared VCO is unsigned minimum.
          c.hi[lane] = c.rateHi > 0
            ? signed16(Math.min(unsigned16(c.hi[lane]), unsigned16(c.target)))
            : Math.max(c.hi[lane], c.target);
        }

        // Without AUX, 0x1be0–0x1be8 redirects wet writes to a fixed scratch
        // vector outside the saved envelope state. It has no DSP-visible use;
        // the dry channels and all five saved state vectors still run normally.
        for (let bus = 0; bus < (auxiliary ? 2 : 1); bus++) {
          const destination = outputs[channel + bus * 2], volume = bus ? wet : dry;
          for (let i = 0; i < 8; i++) {
            // All input/output buffers were checked as disjoint above, so
            // lane reads cannot observe stores to another lane or channel.
            const previous = this.s16(destination + p + i * 2);
            const sample = this.s16(input + p + i * 2);
            const gain = mulFraction(c.hi[i], volume);
            this.put16(destination + p + i * 2, mixSample(previous, sample, gain));
          }
        }
      }
    }

    for (let channel = 0; channel < 2; channel++) {
      const c = channels[channel];
      for (let i = 0; i < 8; i++) {
        this.put16(DMEM_SCRATCH + channel * 32 + i * 2, c.hi[i]);
        this.put16(DMEM_SCRATCH + channel * 32 + 16 + i * 2, c.lo[i]);
      }
    }

    this.dmem.copyWithin(ENVELOPE_SAVED_CONFIG, config, config + 16);
    this.dma(DMEM_SCRATCH, address, ENVELOPE_STATE_SIZE, true);
  }

  // Variants can change volume progression while retaining the shared buffer,
  // target, mixing and saved-state behavior above.
  initializeEnvelope(channel, initial) {
    initializeEnvelopeChannel(channel, initial);
  }

  advanceEnvelope(channel) {
    for (let lane = 0; lane < 8; lane++) {
      const value = mulFixed16(channel.hi[lane], channel.lo[lane], channel.rateHi, channel.rateLo);
      channel.hi[lane] = clampFixed16Hi(value);
      channel.lo[lane] = clampFixed16Lo(value);
    }
  }
}
