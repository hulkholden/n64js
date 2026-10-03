import { describe, expect, test } from 'bun:test';
import { DiddyBlastAudio } from './audio_diddy_blast.js';

const OPCODE_SETBUFF = 0x08;
const OPCODE_RESAMPLE = 0x05;
const FLAG_INIT = 0x01;

const RDRAM_SIZE = 0x4000;
const DMEM_SIZE = 0x1000;
const DMEM_SAMPLE_BUFFER = 0x5c0;
const DMEM_INPUT = 0x600;
const DMEM_OUTPUT = 0x700;
const RDRAM_RESAMPLE_STATE = 0x1000;

const SAMPLE_BYTES = Int16Array.BYTES_PER_ELEMENT;
const INPUT_SAMPLE_COUNT = 16;
const OUTPUT_SAMPLE_COUNT = 8;

const DMEM_RESAMPLE_TABLE = 0x0d0;
const RESAMPLE_TAP_COUNT = 4;
const RESAMPLE_PHASE_COUNT = 64;
const RESAMPLE_PHASE_SHIFT = 10;
const RESAMPLE_PHASE_BYTES = RESAMPLE_TAP_COUNT * SAMPLE_BYTES;
const RESAMPLE_STATE_PHASE_OFFSET = RESAMPLE_TAP_COUNT * SAMPLE_BYTES;
const RESAMPLE_UNITY_PITCH = 0x8000;
const HALF_GAIN = 0x4000; // Signed Q1.15 coefficient.

function fixture() {
  const a = new DiddyBlastAudio(new Uint8Array(RDRAM_SIZE), new Uint8Array(DMEM_SIZE));
  const inputOffset = DMEM_INPUT - DMEM_SAMPLE_BUFFER;
  const outputOffset = DMEM_OUTPUT - DMEM_SAMPLE_BUFFER;
  const count = OUTPUT_SAMPLE_COUNT * SAMPLE_BYTES;
  a.execute((OPCODE_SETBUFF << 24) | inputOffset, (outputOffset << 16) | count);
  return a;
}

describe('Diddy/Blast resampler table', () => {
  test('uses the relocated phase-zero coefficients', () => {
    const a = fixture();
    a.put16(DMEM_RESAMPLE_TABLE, HALF_GAIN); // Synthetic filter with a single half-gain first tap.
    for (let i = 0; i < INPUT_SAMPLE_COUNT; i++) {
      a.put16(DMEM_INPUT + i * SAMPLE_BYTES, 100 + i);
    }

    a.execute((OPCODE_RESAMPLE << 24) | (FLAG_INIT << 16) | RESAMPLE_UNITY_PITCH, RDRAM_RESAMPLE_STATE);
    expect(Array.from({ length: OUTPUT_SAMPLE_COUNT }, (_, i) => a.s16(DMEM_OUTPUT + i * SAMPLE_BYTES)))
      .toEqual([0, 0, 0, 0, 50, 51, 51, 52]);
  });

  test('reads the last phase from task DMEM and refreshes coefficients when reused', () => {
    const a = fixture(), state = new DataView(a.ram.buffer);
    const lastPhase = RESAMPLE_PHASE_COUNT - 1;
    const lastTap = RESAMPLE_TAP_COUNT - 1;
    const coefficientAddress = DMEM_RESAMPLE_TABLE + lastPhase * RESAMPLE_PHASE_BYTES + lastTap * SAMPLE_BYTES;
    for (let i = 0; i < RESAMPLE_TAP_COUNT; i++) {
      state.setInt16(RDRAM_RESAMPLE_STATE + i * SAMPLE_BYTES, (i + 1) * 100);
    }
    state.setUint16(RDRAM_RESAMPLE_STATE + RESAMPLE_STATE_PHASE_OFFSET, lastPhase << RESAMPLE_PHASE_SHIFT);
    a.put16(coefficientAddress, HALF_GAIN); // Only the fourth history sample contributes.
    const dmem = a.dmem.slice();

    a.execute(OPCODE_RESAMPLE << 24, RDRAM_RESAMPLE_STATE);
    expect(Array.from({ length: OUTPUT_SAMPLE_COUNT }, (_, i) => a.s16(DMEM_OUTPUT + i * SAMPLE_BYTES)))
      .toEqual(Array(OUTPUT_SAMPLE_COUNT).fill(200));

    a.reset(a.ram, dmem);
    a.put16(coefficientAddress, -HALF_GAIN);
    a.execute(OPCODE_RESAMPLE << 24, RDRAM_RESAMPLE_STATE);
    expect(Array.from({ length: OUTPUT_SAMPLE_COUNT }, (_, i) => a.s16(DMEM_OUTPUT + i * SAMPLE_BYTES)))
      .toEqual(Array(OUTPUT_SAMPLE_COUNT).fill(-200));
  });
});
