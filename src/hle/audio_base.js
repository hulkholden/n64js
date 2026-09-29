// Shared task memory and atomic RDRAM rollback for audio HLE families.
import { SP_DMEM_SIZE } from '../devices/sp_constants.js';
import { clampShifted32To16 } from './audio_fixed_point.js';
import { round8 } from './audio_buffer.js';

const SAMPLE_BYTES = 2;
const VECTOR_SAMPLES = 8;
const VECTOR_BYTES = VECTOR_SAMPLES * SAMPLE_BYTES;
const ADPCM_FRAME_SAMPLES = 2 * VECTOR_SAMPLES;
const ADPCM_FRAME_BYTES = 1 + ADPCM_FRAME_SAMPLES / 2;
const ADPCM_OUTPUT_BYTES = ADPCM_FRAME_SAMPLES * SAMPLE_BYTES;
const ADPCM_PREDICTOR_BYTES = 2 * VECTOR_BYTES;
const ADPCM_MAX_SHIFT = 12;
const FLAG_INIT = 1;
const FLAG_LOOP = 2;
const ADPCM_FRACTION_BITS = 11;
const ADPCM_SCALE = 1 << ADPCM_FRACTION_BITS;

export class UnsupportedAudioCommand extends Error {}

export class AudioBase {
  constructor(ram, dmem) {
    this.dmem = new Uint8Array(SP_DMEM_SIZE);
    this.view = new DataView(this.dmem.buffer);
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
    this.require(count > 0 && dmem >= 0 && dmem + size <= SP_DMEM_SIZE && address + size <= this.ram.length,
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

  decodeADPCM(flags, address, input, output, count, bookBase, bookSize, loopAddress) {
    const frames = count / ADPCM_OUTPUT_BYTES;
    const inputBytes = frames * ADPCM_FRAME_BYTES;
    this.buffer(input, inputBytes);
    this.buffer(output, count + ADPCM_OUTPUT_BYTES, VECTOR_BYTES);
    this.disjoint(input, inputBytes, output, count + ADPCM_OUTPUT_BYTES);
    this.disjoint(bookBase, bookSize, output, count + ADPCM_OUTPUT_BYTES);

    this.dmem.fill(0, output, output + ADPCM_OUTPUT_BYTES);
    if (!(flags & FLAG_INIT)) this.dma(output, flags & FLAG_LOOP ? loopAddress : address, ADPCM_OUTPUT_BYTES);
    let prev0 = this.s16(output + ADPCM_OUTPUT_BYTES - 2 * SAMPLE_BYTES);
    let prev1 = this.s16(output + ADPCM_OUTPUT_BYTES - SAMPLE_BYTES);

    const residual = this.residual, result = this.result;
    for (let block = 0; block < frames; block++) {
      const p = input + block * ADPCM_FRAME_BYTES, header = this.dmem[p];
      const book = bookBase + (header & 15) * ADPCM_PREDICTOR_BYTES;
      this.require(book + ADPCM_PREDICTOR_BYTES <= bookBase + bookSize, 'Unreviewed ADPCM predictor');

      const shift = Math.min(header >>> 4, ADPCM_MAX_SHIFT);
      for (let i = 0; i < ADPCM_FRAME_SAMPLES; i++) {
        const byte = this.dmem[p + 1 + (i >>> 1)];
        residual[i] = (((i & 1 ? byte : byte >>> 4) & 15) << 28 >> 28) * 2 ** shift;
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
}
