// Shared task memory and atomic RDRAM rollback for audio HLE families.
import { SP_DMEM_SIZE } from '../devices/sp_constants.js';
import { clamp16, clampShifted32To16, fixed16ToInt, unsigned16, signed16, mulFraction } from './audio_fixed_point.js';
import { round8 } from './audio_buffer.js';

const SAMPLE_BYTES = 2;
const VECTOR_SAMPLES = 8;
const VECTOR_BYTES = VECTOR_SAMPLES * SAMPLE_BYTES;
const ADPCM_FRAME_SAMPLES = 2 * VECTOR_SAMPLES;
const ADPCM_OUTPUT_BYTES = ADPCM_FRAME_SAMPLES * SAMPLE_BYTES;
const ADPCM_PREDICTOR_BYTES = 2 * VECTOR_BYTES;
const FLAG_INIT = 1;
const FLAG_LOOP = 2;
const ADPCM_FRACTION_BITS = 11;
const ADPCM_SCALE = 1 << ADPCM_FRACTION_BITS;

// Shared saved-state layouts, relative to each program's scratch base.
const POLE_STATE_BYTES = 8;
const POLE_HISTORY_OFFSET = 4;
const POLE_FRACTION_BITS = 14;
const RESAMPLE_STATE_BYTES = 32;
const RESAMPLE_HISTORY_BYTES = 8;
const RESAMPLE_PHASE_OFFSET = 8;
const RESAMPLE_INPUT_ADJUST_OFFSET = 10;
const RESAMPLE_TAIL_OFFSET = 16;
const RESAMPLE_TABLE_PHASE_SHIFT = 10;
const RESAMPLE_TABLE_STRIDE = 8;
const RESAMPLE_FLAG_HALF_HISTORY = 2;
const RESAMPLE_FLAG_DOUBLE_HISTORY = 4;

export class UnsupportedAudioCommand extends Error {}

export class AudioBase {
  constructor(ram, dmem) {
    this.dmem = new Uint8Array(SP_DMEM_SIZE);
    this.view = new DataView(this.dmem.buffer);
    this.poleA = new Int16Array(VECTOR_SAMPLES);
    this.poleB = new Int16Array(VECTOR_SAMPLES);
    this.poleScaled = new Int16Array(VECTOR_SAMPLES);
    this.samples = new Int16Array(ADPCM_FRAME_SAMPLES);
    this.result = new Int16Array(VECTOR_SAMPLES);
    this.residual = new Int16Array(ADPCM_FRAME_SAMPLES);

    // Grow on first encountering a larger task, then reuse the capacity.
    this.undoWords = new Int32Array(4096);
    this.writeAddresses = new Uint32Array(128);
    this.writeSizes = new Uint16Array(128);
    this.reset(ram, dmem);
  }

  reset(ram, dmem) {
    if (this.ram !== ram) {
      this.ram = ram;
      this.ramView = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
    }

    this.dmem.set(dmem);
    this.commit();
  }

  commit() {
    // RDRAM was written eagerly; a successful task no longer needs its undo log.
    this.writeCount = 0;
    this.undoCount = 0;
  }

  u16(p) { return this.view.getUint16(p); }
  s16(p) { return this.view.getInt16(p); }
  put16(p, v) { this.view.setUint16(p, v); }

  require(condition, reason) {
    if (!condition) throw new UnsupportedAudioCommand(reason);
  }

  disjoint(a, aSize, b, bSize) {
    this.require(a + aSize <= b || b + bSize <= a, 'Overlapping audio buffers are not reviewed');
  }

  dma(dmem, address, count, write = false) {
    // SP address registers discard the bottom three bits; length rounds up.
    dmem &= ~7;
    address &= ~7;
    const size = round8(count);
    this.require(count > 0 && dmem >= 0 && dmem + size <= SP_DMEM_SIZE && address >= 0 && address + size <= this.ram.length,
      'Unreviewed audio DMA');

    // Signed words preserve the bytes while avoiding boxed unsigned values
    // at DataView call boundaries and when reading the undo journal.
    if (write) {
      this.reserveUndo(size >>> 2);
      this.writeAddresses[this.writeCount] = address;
      this.writeSizes[this.writeCount++] = size;

      for (let i = 0; i < size; i += 4) {
        this.undoWords[this.undoCount++] = this.ramView.getInt32(address + i);
        this.ramView.setInt32(address + i, this.view.getInt32(dmem + i));
      }
    } else {
      for (let i = 0; i < size; i += 4) this.view.setInt32(dmem + i, this.ramView.getInt32(address + i));
    }
  }

  reserveUndo(words) {
    if (this.undoCount + words > this.undoWords.length) {
      const grown = new Int32Array(Math.max(this.undoWords.length * 2, this.undoCount + words));
      grown.set(this.undoWords);
      this.undoWords = grown;
    }

    if (this.writeCount === this.writeAddresses.length) {
      const addresses = new Uint32Array(this.writeCount * 2);
      const sizes = new Uint16Array(this.writeCount * 2);
      addresses.set(this.writeAddresses);
      sizes.set(this.writeSizes);
      this.writeAddresses = addresses;
      this.writeSizes = sizes;
    }
  }

  rollback() {
    for (let i = this.writeCount - 1; i >= 0; i--) {
      const address = this.writeAddresses[i], size = this.writeSizes[i];
      this.undoCount -= size >>> 2;
      for (let p = 0; p < size; p += 4) this.ramView.setInt32(address + p, this.undoWords[this.undoCount + (p >>> 2)]);
    }

    this.commit();
  }

  decodeADPCM(flags, address, input, output, count, bookBase, bookSize, loopAddress, residualBits = 4) {
    const frames = count / ADPCM_OUTPUT_BYTES;
    const samplesPerByte = 8 / residualBits;
    const signShift = 32 - residualBits;
    const frameBytes = 1 + ADPCM_FRAME_SAMPLES * residualBits / 8;
    const inputBytes = frames * frameBytes;
    this.buffer(input, inputBytes);
    this.buffer(output, count + ADPCM_OUTPUT_BYTES, VECTOR_BYTES);
    // A compressed stream may overlap already-consumed input. Guard the
    // history write and each frame against the bytes still needed afterwards.
    // RSP prefetches the next frame, but requiring it to survive is conservative.
    if (inputBytes && input < output + count + ADPCM_OUTPUT_BYTES && output < input + inputBytes) {
      this.disjoint(input, inputBytes, output, ADPCM_OUTPUT_BYTES);
      for (let frame = 1; frame < frames; frame++) {
        this.disjoint(input + frame * frameBytes, inputBytes - frame * frameBytes,
          output + frame * ADPCM_OUTPUT_BYTES, ADPCM_OUTPUT_BYTES);
      }
    }
    this.disjoint(bookBase, bookSize, output, count + ADPCM_OUTPUT_BYTES);

    this.dmem.fill(0, output, output + ADPCM_OUTPUT_BYTES);
    if (!(flags & FLAG_INIT)) this.dma(output, flags & FLAG_LOOP ? loopAddress : address, ADPCM_OUTPUT_BYTES);
    let prev0 = this.s16(output + ADPCM_OUTPUT_BYTES - 2 * SAMPLE_BYTES);
    let prev1 = this.s16(output + ADPCM_OUTPUT_BYTES - SAMPLE_BYTES);

    const residual = this.residual, result = this.result;
    for (let block = 0; block < frames; block++) {
      const p = input + block * frameBytes, header = this.dmem[p];
      const book = bookBase + (header & 15) * ADPCM_PREDICTOR_BYTES;
      this.require(book + ADPCM_PREDICTOR_BYTES <= bookBase + bookSize, 'Unreviewed ADPCM predictor');

      const shift = Math.min(header >>> 4, 16 - residualBits);
      for (let i = 0; i < ADPCM_FRAME_SAMPLES; i++) {
        const byte = this.dmem[p + 1 + Math.floor(i / samplesPerByte)];
        const bits = byte >>> ((samplesPerByte - 1 - i % samplesPerByte) * residualBits);
        residual[i] = (bits << signShift >> signShift) * 2 ** shift;
      }

      for (let half = 0; half < ADPCM_FRAME_SAMPLES; half += VECTOR_SAMPLES) {
        for (let i = 0; i < VECTOR_SAMPLES; i++) {
          let sum = this.s16(book + i * SAMPLE_BYTES) * prev0
            + this.s16(book + VECTOR_BYTES + i * SAMPLE_BYTES) * prev1
            + residual[half + i] * ADPCM_SCALE;
          for (let j = 0; j < i; j++) sum += this.s16(book + VECTOR_BYTES + (i - j - 1) * SAMPLE_BYTES) * residual[half + j];
          result[i] = clampShifted32To16(sum, ADPCM_FRACTION_BITS);
        }

        const destination = output + (block + 1) * ADPCM_OUTPUT_BYTES + half * SAMPLE_BYTES;
        for (let i = 0; i < VECTOR_SAMPLES; i++) this.put16(destination + i * SAMPLE_BYTES, result[i]);
        prev0 = result[VECTOR_SAMPLES - 2]; prev1 = result[VECTOR_SAMPLES - 1];
      }
    }

    this.dma(output + count, address, ADPCM_OUTPUT_BYTES, true);
  }

  filterPole(flags, gain, address, input, output, count, book, scratch) {
    if (!count) return;

    this.buffer(input, count, SAMPLE_BYTES);
    this.buffer(output, count, SAMPLE_BYTES);
    if (input !== output) this.disjoint(input, count, output, count);
    this.disjoint(book, 2 * VECTOR_BYTES, output, count);

    // 0x176c clears only four bytes, even on INIT. The last two history
    // samples at (scratch + POLE_HISTORY_OFFSET) are retained. Reproduce the actual program.
    this.dmem.fill(0, scratch, (scratch + POLE_HISTORY_OFFSET));
    if (!(flags & FLAG_INIT)) this.dma(scratch, address, POLE_STATE_BYTES);
    let prev0 = this.s16((scratch + POLE_HISTORY_OFFSET)), prev1 = this.s16((scratch + POLE_HISTORY_OFFSET) + SAMPLE_BYTES);

    const a = this.poleA, b = this.poleB, scaled = this.poleScaled;
    for (let i = 0; i < VECTOR_SAMPLES; i++) {
      a[i] = this.s16(book + i * SAMPLE_BYTES);
      b[i] = this.s16((book + VECTOR_BYTES) + i * SAMPLE_BYTES);
      scaled[i] = fixed16ToInt(b[i] * unsigned16(gain * 4));
      this.put16((book + VECTOR_BYTES) + i * SAMPLE_BYTES, scaled[i]);
    }

    const samples = this.samples, result = this.result;
    for (let p = 0; p < count; p += VECTOR_BYTES) {
      for (let i = 0; i < VECTOR_SAMPLES; i++) samples[i] = this.s16(input + p + i * SAMPLE_BYTES);

      for (let i = 0; i < VECTOR_SAMPLES; i++) {
        let sum = a[i] * prev0 + b[i] * prev1 + samples[i] * signed16(gain);
        for (let j = 0; j < i; j++) sum += scaled[i - j - 1] * samples[j];
        // VMADH wraps a signed 32-bit sum; VSAR/VMUDN/VMADH shift by 14.
        result[i] = clampShifted32To16(sum, POLE_FRACTION_BITS);
      }

      for (let i = 0; i < VECTOR_SAMPLES; i++) this.put16(output + p + i * SAMPLE_BYTES, result[i]);
      prev0 = result[VECTOR_SAMPLES - 2]; prev1 = result[VECTOR_SAMPLES - 1];
    }

    this.dma(output + count - POLE_STATE_BYTES, address, POLE_STATE_BYTES, true);
  }

  resamplePolyphase(flags, pitch, address, input, output, count, tableBase, scratch, expandedHistory = false) {
    this.require(count > 0, 'Zero-length resampler');
    this.buffer(output, count, VECTOR_BYTES);
    this.disjoint(output, count, scratch, RESAMPLE_STATE_BYTES);

    if (flags & FLAG_INIT) this.dmem.fill(0, scratch, (scratch + RESAMPLE_INPUT_ADJUST_OFFSET));
    else this.dma(scratch, address, RESAMPLE_STATE_BYTES);

    let source = input;
    if (expandedHistory) {
      // Later NEAD programs halve or double the four saved history samples.
      const historyBytes = flags & RESAMPLE_FLAG_HALF_HISTORY ? RESAMPLE_HISTORY_BYTES / 2
        : flags & RESAMPLE_FLAG_DOUBLE_HISTORY ? RESAMPLE_HISTORY_BYTES * 2 : RESAMPLE_HISTORY_BYTES;
      source -= historyBytes;
      this.buffer(source, historyBytes, 2);
      for (let i = 0; i < historyBytes / 2; i++) {
        const lane = flags & RESAMPLE_FLAG_HALF_HISTORY ? i * SAMPLE_BYTES : flags & RESAMPLE_FLAG_DOUBLE_HISTORY ? i >>> 1 : i;
        this.put16(source + i * SAMPLE_BYTES, this.s16(scratch + lane * 2));
      }
    } else {
      if (flags & RESAMPLE_FLAG_HALF_HISTORY) {
        this.buffer(source - 16, 16);
        this.dmem.copyWithin(source - 16, scratch + RESAMPLE_TAIL_OFFSET, scratch + RESAMPLE_STATE_BYTES);
        source -= this.s16(scratch + RESAMPLE_INPUT_ADJUST_OFFSET);
      }
      source -= RESAMPLE_HISTORY_BYTES;
      this.buffer(source, RESAMPLE_HISTORY_BYTES, SAMPLE_BYTES);
      this.dmem.copyWithin(source, scratch, scratch + RESAMPLE_PHASE_OFFSET);
    }
    let phase = this.u16(scratch + RESAMPLE_PHASE_OFFSET);

    const result = this.result;
    for (let p = 0; p < count; p += VECTOR_BYTES) {
      // Each vector iteration loads all eight windows before storing output.
      for (let i = 0; i < VECTOR_SAMPLES; i++) {
        this.buffer(source, RESAMPLE_HISTORY_BYTES, SAMPLE_BYTES);
        const table = tableBase + (phase >>> RESAMPLE_TABLE_PHASE_SHIFT) * RESAMPLE_TABLE_STRIDE;
        const t0 = mulFraction(this.s16(source), this.s16(table));
        const t1 = mulFraction(this.s16(source + 2), this.s16(table + 2));
        const t2 = mulFraction(this.s16(source + 4), this.s16(table + 4));
        const t3 = mulFraction(this.s16(source + 6), this.s16(table + 6));
        result[i] = clamp16(clamp16(t0 + t1) + clamp16(t2 + t3));

        phase += pitch * 2;
        source += (phase >>> 16) * 2;
        phase = unsigned16(phase);
      }

      for (let i = 0; i < VECTOR_SAMPLES; i++) this.put16(output + p + i * SAMPLE_BYTES, result[i]);
    }

    this.buffer(source, RESAMPLE_HISTORY_BYTES, SAMPLE_BYTES);
    this.dmem.copyWithin(scratch, source, source + RESAMPLE_HISTORY_BYTES);
    this.put16((scratch + RESAMPLE_PHASE_OFFSET), phase);

    if (!expandedHistory) {
      const remainder = (source + RESAMPLE_HISTORY_BYTES - input) & 15;
      const tail = source + RESAMPLE_HISTORY_BYTES - remainder;
      this.buffer(tail, VECTOR_BYTES);
      this.put16((scratch + RESAMPLE_INPUT_ADJUST_OFFSET), remainder ? 16 - remainder : 0);
      this.dmem.copyWithin((scratch + RESAMPLE_TAIL_OFFSET), tail, tail + VECTOR_BYTES);
    }

    this.dma(scratch, address, RESAMPLE_STATE_BYTES, true);
  }
}
