// Derived from the captured NEAD RSP programs. The default layout and command
// table are Star Fox's; specialities override only reviewed differences.
import { AudioBase, UnsupportedAudioCommand } from './audio_base.js';
import { round8, round16, round32, round64 } from './audio_buffer.js';
import {
  FIXED16_ONE, clamp16, mulUnsignedFraction, clampFractionSum, signed16, unsigned16, mixSample, clampFixed16Hi,
} from './audio_fixed_point.js';
import * as C from './audio_nead_constants.js';

export class NEADAudio extends AudioBase {
  constructor(ram, dmem) {
    super(ram, dmem);
    this.bufferStart = this.book;
    this.bufferLimit = this.bufferEnd;
    this.vector31 = new Uint16Array(C.VECTOR_SAMPLES);
    this.vector31Known = false;
    this.filterCount = 0;
    this.copyBlock = new Uint8Array(C.DUPLICATE_BLOCK_BYTES);
    this.multiplyCoefficients = new Int16Array(C.ADD_BLOCK_BYTES / C.SAMPLE_BYTES);
    this.envelopeVolumes = new Uint16Array(6);
    this.envelopeRates = new Uint16Array(3);
    this.envelopeOutputs = new Uint16Array(4);
  }

  get parameters() { return C.DMEM_PARAMS; }
  get commandBuffer() { return C.DMEM_COMMAND_BUFFER; }
  get commandBufferSize() { return C.COMMAND_BUFFER_SIZE; }
  get book() { return C.DMEM_ADPCM_BOOK; }
  get bookSize() { return C.ADPCM_BOOK_SIZE; }
  get bufferEnd() { return this.scratch; }
  get scratch() { return C.DMEM_SCRATCH; }
  get resampleTable() { return C.DMEM_RESAMPLE_TABLE; }
  get expandedResampleHistory() { return true; }
  get bufferBase() { return 0; }
  get input() { return this.u16(this.parameters + C.PARAM_INPUT); }
  get output() { return this.u16(this.parameters + C.PARAM_OUTPUT); }
  get count() { return this.u16(this.parameters + C.PARAM_COUNT); }
  get loopParameter() { return C.PARAM_LOOP; }
  get filterStateSize() { return C.VECTOR_BYTES; }
  get loopAddress() { return this.view.getUint32(this.parameters + this.loopParameter); }

  initializeTask(rsp) {
    this.envelopeReady = 0;
    this.filterCount = 0;
    this.vector31Known = !!rsp?.getVecU16;
    if (this.vector31Known) for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.vector31[i] = rsp.getVecU16(C.RSP_CONSTANT_VECTOR, i);
  }

  finishTask(rsp) {
    if (this.vector31Known && rsp?.setVecS16) for (let i = 0; i < C.VECTOR_SAMPLES; i++) rsp.setVecS16(C.RSP_CONSTANT_VECTOR, i, this.vector31[i]);
  }

  beginCommandBatch() {}
  address(word) { return word & C.RAM_ADDRESS_MASK; }

  buffer(p, n, alignment = 1) {
    this.require(p >= this.bufferStart && n >= 0 && p + n <= this.bufferLimit && p % alignment === 0,
      'Unreviewed NEAD buffer');
  }

  execute(w0, w1) {
    this.filterCount = 0;
    const opcode = w0 >>> 24, low = unsigned16(w0), flags = (w0 >>> 16) & 255;

    // Envelope configuration lives in RSP registers. Other DSP commands can
    // overwrite them, so require a fresh setup before consuming those values.
    if (opcode !== C.OPCODE_ENVSETUP1 && opcode !== C.OPCODE_ENVSETUP2 && opcode !== C.OPCODE_ENVMIXER) this.envelopeReady = 0;

    switch (opcode) {
      case C.OPCODE_NOOP:
      case C.OPCODE_RESERVED_03:
      case C.OPCODE_FILTER:
      case C.OPCODE_RESERVED_09:
      case C.OPCODE_FIR_FILTER:
      case C.OPCODE_RESERVED_1C:
      case C.OPCODE_RESERVED_1D:
      case C.OPCODE_RESERVED_1E:
      case C.OPCODE_RESERVED_1F:
        return;

      case C.OPCODE_ADPCM:
        this.loadVector31(0);
        return this.decodeADPCM(flags, this.address(w1), this.input, this.output, round32(this.count), this.book, this.bookSize, flags & C.FLAG_LOOP ? this.loopAddress : 0);
      case C.OPCODE_CLEARBUFF: {
        const p = this.bufferBase + low, count = round16(unsigned16(w1));
        this.buffer(p, count);
        this.dmem.fill(0, p, p + count);
        return;
      }

      case C.OPCODE_SETBUFF:
        this.put16(this.parameters + C.PARAM_INPUT, low + this.bufferBase);
        this.put16(this.parameters + C.PARAM_OUTPUT, (w1 >>> 16) + this.bufferBase);
        this.put16(this.parameters + C.PARAM_COUNT, w1);
        return;

      case C.OPCODE_SETLOOP:
        this.view.setUint32(this.parameters + this.loopParameter, this.address(w1));
        return;
      case C.OPCODE_RESAMPLE:
        this.loadVector31(C.DMEM_RESAMPLE_STEP_VECTOR);
        return this.resamplePolyphase(flags, low, this.address(w1), this.input, this.output, round16(this.count), this.resampleTable, this.scratch, this.expandedResampleHistory);
      case C.OPCODE_POLEF:
        this.loadVector31(0);
        if (this.count) this.vector31[5] = low;
        return this.filterPole(flags, low, this.address(w1), this.input, this.output, round16(this.count), this.book, this.scratch);
      case C.OPCODE_LOADADPCM:
        this.require(low > 0 && low <= this.bookSize, 'Unreviewed NEAD predictor book');
        return this.dma(this.book, this.address(w1), low);
      case C.OPCODE_LOADBUFF:
      case C.OPCODE_SAVEBUFF: {
        const p = this.bufferBase + low, count = (w0 >>> 12) & C.PACKED_BUFFER_MASK;
        this.buffer(p & ~7, count);
        return this.dma(p, this.address(w1), count, opcode === C.OPCODE_SAVEBUFF);
      }

      case C.OPCODE_RESAMPLE_NEAREST: return this.resampleNearest(low, unsigned16(w1));
      case C.OPCODE_PCM8: return this.decodePCM8(flags, this.address(w1));
      case C.OPCODE_GAIN: return this.gain(flags, low, w1 >>> 16);
      case C.OPCODE_MULTIPLY: return this.multiply(low, w1 >>> 16, unsigned16(w1) + flags);
      case C.OPCODE_DUPLICATE: return this.duplicate(low, w1 >>> 16, Math.max(1, flags));
      case C.OPCODE_DMEMMOVE: return this.move(this.bufferBase + low, this.bufferBase + (w1 >>> 16), round16(unsigned16(w1)));
      case C.OPCODE_COPY:
        return this.move(this.bufferBase + low, this.bufferBase + (w1 >>> 16), Math.max(1, flags) * Math.max(C.VECTOR_BYTES * 2, round32(unsigned16(w1))), C.VECTOR_BYTES * 2);
      case C.OPCODE_DOWNSAMPLE: return this.downsample(this.bufferBase + (w1 >>> 16), this.bufferBase + unsigned16(w1), Math.max(C.VECTOR_SAMPLES, round8(low)));
      case C.OPCODE_MIXER: return this.mix(w0, w1);
      case C.OPCODE_ADDMIXER: return this.addMix(w0, w1);
      case C.OPCODE_INTERLEAVE: return this.interleave(this.bufferBase + (w1 >>> 16), this.bufferBase + unsigned16(w1), this.output, round16(this.count), C.VECTOR_SAMPLES);

      case C.OPCODE_ENVSETUP1: return this.setupEnvelope1(w0, w1);
      case C.OPCODE_ENVSETUP2: return this.setupEnvelope2(w1);
      case C.OPCODE_ENVMIXER: return this.envelope(w0, w1);

      default: throw new UnsupportedAudioCommand(`Unsupported NEAD opcode ${opcode}`);
    }
  }

  decodePCM8(flags, address) {
    const count = round32(this.count), input = this.input, output = this.output;
    const history = C.ADPCM_HISTORY_BYTES;
    this.buffer(input, count / 2);
    this.buffer(output, count + history, C.VECTOR_BYTES);
    this.disjoint(input, count / 2, output, count + history);
    this.dmem.fill(0, output, output + history);
    if (!(flags & C.FLAG_INIT)) this.dma(output, flags & C.FLAG_LOOP ? this.loopAddress : address, history);
    for (let i = 0; i < count / 2; i++) this.put16(output + history + i * C.SAMPLE_BYTES, this.dmem[input + i] << 8);
    this.dma(output + count, address, history, true);
  }

  resampleNearest(pitch, phase) {
    const count = Math.max(C.RESAMPLE_NEAREST_BYTES, round8(this.count)), output = this.output;
    this.buffer(output, count, C.SAMPLE_BYTES);
    let position = this.input * FIXED16_ONE + phase;
    for (let p = 0; p < count; p += C.RESAMPLE_NEAREST_BYTES) {
      for (let i = 0; i < C.RESAMPLE_NEAREST_LANES; i++) {
        const source = (position >>> 16) & 0xfffe;
        this.buffer(source, C.SAMPLE_BYTES, C.SAMPLE_BYTES);
        this.samples[i] = this.s16(source);
        position = (position + pitch * 4) >>> 0;
      }
      for (let i = 0; i < C.RESAMPLE_NEAREST_LANES; i++) this.put16(output + p + i * C.SAMPLE_BYTES, this.samples[i]);
    }
  }

  gain(gain, count, buffer) {
    count = Math.max(C.VECTOR_BYTES * 2, round32(count));
    this.buffer(buffer, count, C.VECTOR_BYTES);
    for (let p = 0; p < count; p += C.SAMPLE_BYTES) this.put16(buffer + p, clampFixed16Hi(this.s16(buffer + p) * gain * (FIXED16_ONE / (1 << C.GAIN_FRACTION_BITS))));
  }

  multiply(count, buffer, coefficients) {
    count = Math.max(C.ADD_BLOCK_BYTES, round64(count));
    this.buffer(buffer, count, C.VECTOR_BYTES);
    this.buffer(coefficients, C.ADD_BLOCK_BYTES, C.SAMPLE_BYTES);
    for (let i = 0; i < this.multiplyCoefficients.length; i++) this.multiplyCoefficients[i] = this.s16(coefficients + i * C.SAMPLE_BYTES);
    for (let p = 0; p < count; p += C.SAMPLE_BYTES) this.put16(buffer + p, clamp16(this.s16(buffer + p) * this.multiplyCoefficients[(p / C.SAMPLE_BYTES) & (this.multiplyCoefficients.length - 1)]));
  }

  duplicate(input, output, copies) {
    this.buffer(input, this.copyBlock.length, C.VECTOR_BYTES);
    this.buffer(output, copies * this.copyBlock.length, C.VECTOR_BYTES);
    for (let i = 0; i < this.copyBlock.length; i++) this.copyBlock[i] = this.dmem[input + i];
    for (let i = 0; i < copies; i++) this.dmem.set(this.copyBlock, output + i * this.copyBlock.length);
  }

  move(from, to, count, block = C.VECTOR_BYTES) {
    this.buffer(from, count, block === C.VECTOR_BYTES ? 1 : C.VECTOR_BYTES);
    this.buffer(to, count, block === C.VECTOR_BYTES ? 1 : C.VECTOR_BYTES);
    for (let i = 0; i < count; i += block) this.dmem.copyWithin(to + i, from + i, from + i + block);
  }

  downsample(input, output, count) {
    this.buffer(input, count * 4, C.SAMPLE_BYTES);
    this.buffer(output, count * C.SAMPLE_BYTES, C.SAMPLE_BYTES);
    for (let p = 0; p < count; p += C.VECTOR_SAMPLES) {
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.samples[i] = this.s16(input + (p + i) * 4);
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.put16(output + (p + i) * C.SAMPLE_BYTES, this.samples[i]);
    }
  }

  interleave(left, right, output, count, lanes) {
    this.buffer(left, count, lanes === C.VECTOR_SAMPLES ? C.VECTOR_BYTES : C.SAMPLE_BYTES);
    this.buffer(right, count, lanes === C.VECTOR_SAMPLES ? C.VECTOR_BYTES : C.SAMPLE_BYTES);
    this.buffer(output, count * 2, C.SAMPLE_BYTES);
    for (let p = 0; p < count; p += lanes * C.SAMPLE_BYTES) {
      for (let i = 0; i < lanes; i++) {
        this.samples[i] = this.s16(left + p + i * C.SAMPLE_BYTES);
        this.samples[i + lanes] = this.s16(right + p + i * C.SAMPLE_BYTES);
      }
      for (let i = 0; i < lanes; i++) {
        this.put16(output + p * 2 + i * 4, this.samples[i]);
        this.put16(output + p * 2 + i * 4 + C.SAMPLE_BYTES, this.samples[i + lanes]);
      }
    }
  }

  loadVector31(address) {
    for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.vector31[i] = this.u16(address + i * C.SAMPLE_BYTES);
    this.vector31Known = true;
  }

  mix(w0, w1) {
    this.loadVector31(0);
    const count = Math.max(C.VECTOR_BYTES * 2, round32((w0 >>> 12) & C.PACKED_BUFFER_MASK));
    const input = this.bufferBase + (w1 >>> 16), output = this.bufferBase + unsigned16(w1), gain = signed16(w0);
    this.buffer(input, count, C.VECTOR_BYTES);
    this.buffer(output, count, C.VECTOR_BYTES);
    // Earlier output cannot overwrite unread input; forward overlap needs
    // the RSP pipeline’s extra prefetched vectors and remains on LLE.
    if (output > input) this.disjoint(input, count, output, count);
    for (let i = 0; i < count; i += C.SAMPLE_BYTES) this.put16(output + i, mixSample(this.s16(output + i), this.s16(input + i), gain));
  }

  addMix(w0, w1) {
    const count = Math.max(C.ADD_BLOCK_BYTES, round64((w0 >>> 12) & C.PACKED_BUFFER_MASK));
    const input = w1 >>> 16, output = unsigned16(w1);
    this.buffer(input, count, C.VECTOR_BYTES);
    this.buffer(output, count, C.VECTOR_BYTES);
    if (input !== output) this.disjoint(input, count, output, count);
    // VADDC doubles V31, leaving one carry bit per lane for the first VADD.
    this.require(this.vector31Known, 'NEAD add mixer carry register not initialized');
    for (let i = 0; i < count; i += C.SAMPLE_BYTES) {
      const carry = i < C.VECTOR_BYTES ? this.vector31[i / C.SAMPLE_BYTES] >>> 15 : 0;
      this.put16(output + i, clamp16(this.s16(output + i) + this.s16(input + i) + carry));
    }
    for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.vector31[i] *= 2;
  }

  setupEnvelope1(w0, w1) {
    const v = this.envelopeVolumes, r = this.envelopeRates;
    r[0] = w1 >>> 16; r[1] = w1; r[2] = w0;
    v[4] = (w0 >>> 8) & 0xff00; v[5] = v[4] + r[2];
    this.envelopeReady = 1;
  }

  setupEnvelope2(w1) {
    this.require(this.envelopeReady & 1, 'NEAD envelope rates not initialized');
    const v = this.envelopeVolumes, r = this.envelopeRates;
    v[0] = w1 >>> 16; v[1] = v[0] + r[0];
    v[2] = w1; v[3] = v[2] + r[1];
    this.envelopeReady |= 2;
  }

  get envelopeBlockSamples() { return C.VECTOR_SAMPLES * 2; }

  envelope(w0, w1) {
    this.require(this.envelopeReady === 3, 'NEAD envelope registers not initialized');
    const input = this.bufferBase + ((w0 >>> 12) & C.PACKED_BUFFER_MASK);
    const block = this.envelopeBlockSamples;
    const count = Math.max(block, Math.ceil(((w0 >>> 8) & 255) / block) * block);
    const out = this.envelopeOutputs, v = this.envelopeVolumes, rates = this.envelopeRates;
    out[0] = this.bufferBase + ((w1 >>> 20) & C.PACKED_BUFFER_MASK);
    out[1] = this.bufferBase + ((w1 >>> 12) & C.PACKED_BUFFER_MASK);
    out[2] = this.bufferBase + ((w1 >>> 4) & C.PACKED_BUFFER_MASK);
    out[3] = this.bufferBase + ((w1 << 4) & C.PACKED_BUFFER_MASK);
    const bytes = count * C.SAMPLE_BYTES;
    this.buffer(input, bytes, C.VECTOR_BYTES);
    for (let bus = 0; bus < 4; bus++) {
      this.buffer(out[bus], bytes, C.VECTOR_BYTES);
      this.disjoint(input, bytes, out[bus], bytes);
      for (let other = 0; other < bus; other++) this.disjoint(out[bus], bytes, out[other], bytes);
    }
    // The two-vector variants double the scalar increments at ENVMIXER entry.
    const vectors = block / C.VECTOR_SAMPLES;
    for (let channel = 0; channel < 3; channel++) rates[channel] *= vectors;
    const leftMask = this.envelopeDryMask(w0, 0), rightMask = this.envelopeDryMask(w0, 1);
    const swap = this.envelopeSwap(w0), wetEnabled = this.envelopeWetEnabled;
    const wetLeftMask = this.envelopeWetMask(w0, 0), wetRightMask = this.envelopeWetMask(w0, 1);
    for (let p = 0; p < count; p += block) {
      for (let i = 0; i < block; i++) {
        const lane = i >= C.VECTOR_SAMPLES ? 1 : 0, offset = (p + i) * C.SAMPLE_BYTES;
        const sample = this.s16(input + offset);
        const left = mulUnsignedFraction(sample, v[lane]) ^ leftMask;
        const right = mulUnsignedFraction(sample, v[2 + lane]) ^ rightMask;
        this.put16(out[0] + offset, clamp16(this.s16(out[0] + offset) + left));
        this.put16(out[1] + offset, clamp16(this.s16(out[1] + offset) + right));
        const wetLeft = mulUnsignedFraction(left, v[4 + lane]) ^ wetLeftMask;
        const wetRight = mulUnsignedFraction(right, v[4 + lane]) ^ wetRightMask;
        if (wetEnabled) this.put16(out[2] + offset, clamp16(this.s16(out[2] + offset) + (swap ? wetRight : wetLeft)));
        if (wetEnabled) this.put16(out[3] + offset, clamp16(this.s16(out[3] + offset) + (swap ? wetLeft : wetRight)));
      }
      for (let channel = 0; channel < 3; channel++) {
        v[channel * 2] += rates[channel];
        v[channel * 2 + 1] += rates[channel];
      }
    }
  }

  // Setup retains coefficients and the scalar byte count for the next filter.
  // The processing command saves input history, not the filtered output.
  firFilter(w0, w1) {
    const flags = (w0 >>> 16) & 255, address = this.address(w1);
    const state = this.scratch, stateSize = this.filterStateSize;
    const coefficients = state + stateSize + C.FIR_COEFFICIENT_BYTES;
    this.dmem.fill(0, state, state + stateSize);

    if (flags > 1) {
      this.filterCount = Math.max(C.VECTOR_BYTES, round16(unsigned16(w0)));
      this.dmem.fill(0, state + stateSize, coefficients);
      this.dmem.fill(0, coefficients + C.VECTOR_BYTES, coefficients + 2 * C.VECTOR_BYTES);
      this.dma(coefficients, address, C.FIR_COEFFICIENT_BYTES);
      return;
    }

    this.require(this.filterCount > 0, 'NEAD FIR coefficients not initialized');
    if (!flags) this.dma(state, address, stateSize);
    if (stateSize === 2 * C.VECTOR_BYTES) {
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) {
        const value = (this.s16(coefficients + i * C.SAMPLE_BYTES) + this.s16(state + C.VECTOR_BYTES + i * C.SAMPLE_BYTES) + 1) >> 1;
        this.put16(coefficients + i * C.SAMPLE_BYTES, value);
        this.put16(state + C.VECTOR_BYTES + i * C.SAMPLE_BYTES, value);
      }
    }

    const input = unsigned16(w0), count = this.filterCount;
    this.buffer(input, count, C.VECTOR_BYTES);
    this.disjoint(input, count, state, stateSize + 3 * C.VECTOR_BYTES);

    // V31 retains a shifted coefficient vector, subsequently consumed by ADDMIXER.
    this.loadVector31(coefficients - C.VECTOR_BYTES + C.SAMPLE_BYTES);
    for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.samples[i] = this.s16(state + i * C.SAMPLE_BYTES);
    for (let p = 0; p < count; p += C.VECTOR_BYTES) {
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.samples[C.VECTOR_SAMPLES + i] = this.s16(input + p + i * C.SAMPLE_BYTES);
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) {
        let sum = 0;
        for (let tap = 0; tap < C.FIR_COEFFICIENTS; tap++) sum += this.samples[C.VECTOR_SAMPLES + i - tap] * this.s16(coefficients + tap * C.SAMPLE_BYTES);
        this.put16(input + p + i * C.SAMPLE_BYTES, clampFractionSum(sum));
      }
      for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.samples[i] = this.samples[C.VECTOR_SAMPLES + i];
    }
    for (let i = 0; i < C.VECTOR_SAMPLES; i++) this.put16(state + i * C.SAMPLE_BYTES, this.samples[i]);
    this.dma(state, address, stateSize, true);
    this.filterCount = 0;
  }

  get envelopeWetEnabled() { return true; }
  envelopeDryMask(w0, channel) { return w0 & (channel ? 1 : 2) ? -1 : 0; }
  envelopeWetMask() { return 0; }
  envelopeSwap(w0) { return (w0 & 4) !== 0; }
}
