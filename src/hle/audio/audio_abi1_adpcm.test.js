import { describe, expect, test } from 'bun:test';
import { ABI1Audio } from './audio_abi1.js';
import { TetrisphereAudio } from './audio_tetrisphere.js';
import { GoldenEyeAudio } from './audio_goldeneye.js';
import { DiddyBlastAudio } from './audio_diddy_blast.js';
import { UnsupportedAudioCommand } from './audio_base.js';

// Independent command encodings and offsets inferred from the RSP programs.
const OP_ADPCM = 0x01000000;
const OP_SET_BUFFER = 0x08000000;
const INIT = 0x00010000;
const RAM_BYTES = 0x4000;
const DMEM_BYTES = 0x1000;
const BOOK = 0x4c0;
const INPUT = 0x5c0;
const LOW_OUTPUT = 0x630;
const OUTPUT = 0x700;
const STATE = 0x1000;
const FRAME_BYTES = 32;
const ENCODED_BYTES = 9;
const VECTOR_BYTES = 16;
const COEFFICIENT_SCALE = 0x800;

function fixture(Audio, output = OUTPUT) {
  const audio = new Audio(new Uint8Array(RAM_BYTES), new Uint8Array(DMEM_BYTES));
  audio.execute(OP_SET_BUFFER, (output - INPUT) << 16 | FRAME_BYTES);
  return audio;
}

for (const Audio of [ABI1Audio, TetrisphereAudio, GoldenEyeAudio, DiddyBlastAudio]) {
  describe(`${Audio.name} ADPCM predictors`, () => {
    test('upper predictors read live coefficients from sample memory', () => {
      const INITIAL_SAMPLE = 100;
      for (const [predictor, output] of [[7, LOW_OUTPUT], [13, OUTPUT], [15, OUTPUT]]) {
        const audio = fixture(Audio, output);
        const coefficients = BOOK + predictor * FRAME_BYTES;
        for (let p = 0; p < VECTOR_BYTES; p += 2) {
          audio.put16(coefficients + VECTOR_BYTES + p, COEFFICIENT_SCALE);
        }
        audio.ramView.setInt16(STATE + FRAME_BYTES - 2, INITIAL_SAMPLE);
        audio.dmem[INPUT] = predictor;
        audio.dmem.fill(0x11, INPUT + 1, INPUT + ENCODED_BYTES);

        audio.execute(OP_ADPCM, STATE);

        // Each residual adds one; the coefficients carry the preceding sum.
        for (let i = 0; i < FRAME_BYTES / 2; i++) {
          expect(audio.s16(output + FRAME_BYTES + i * 2)).toBe(INITIAL_SAMPLE + i + 1);
          expect(audio.ramView.getInt16(STATE + i * 2)).toBe(INITIAL_SAMPLE + i + 1);
        }
      }
    });

    test('predictors overlapping decoded output still fall back', () => {
      const audio = fixture(Audio, LOW_OUTPUT);
      const OVERLAPPING_PREDICTOR = 13;
      audio.dmem[INPUT] = OVERLAPPING_PREDICTOR;
      audio.ram.fill(0x42);
      const before = audio.ram.slice();
      // A prior store must also be undone when a later command cannot run.
      audio.dma(OUTPUT, STATE, FRAME_BYTES, true);
      expect(() => audio.execute(OP_ADPCM | INIT, STATE)).toThrow(UnsupportedAudioCommand);
      audio.rollback();
      expect(audio.ram).toEqual(before);
    });
  });
}
