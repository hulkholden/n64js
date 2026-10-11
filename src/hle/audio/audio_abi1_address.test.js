import { describe, expect, test } from 'bun:test';
import { ABI1Audio } from './audio_abi1.js';
import { TetrisphereAudio } from './audio_tetrisphere.js';
import { GoldenEyeAudio } from './audio_goldeneye.js';
import { DiddyBlastAudio } from './audio_diddy_blast.js';
import { UnsupportedAudioCommand } from './audio_base.js';

// Independent command encodings and DMEM offsets from the captured programs.
const OP_LOAD = 0x04000000;
const OP_SAVE = 0x06000000;
const OP_SEGMENT = 0x07000000;
const OP_SET_BUFFER = 0x08000000;
const OP_SET_LOOP = 0x0f000000;
const RAM_BYTES = 0x4000;
const DMEM_BYTES = 0x1000;
const SAMPLE_BASE = 0x5c0;
const INPUT = 0x800;
const OUTPUT = 0x900;
const TRANSFER_BYTES = 16;
const LOOP_ADDRESS = 0x370;
const AIDYN_BASE_SLOT = 0x520;
const AIDYN_SEGMENT = 0x80000000;

function fixture(Audio) {
  const audio = new Audio(new Uint8Array(RAM_BYTES), new Uint8Array(DMEM_BYTES));
  audio.execute(OP_SET_BUFFER | (INPUT - SAMPLE_BASE), (OUTPUT - SAMPLE_BASE) << 16 | TRANSFER_BYTES);
  return audio;
}

for (const Audio of [ABI1Audio, TetrisphereAudio, GoldenEyeAudio, DiddyBlastAudio]) {
  describe(`${Audio.name} segment addresses`, () => {
    test('DMA reads the full high-byte index and observes changes to the aliased base', () => {
    // Include the last conventional entry, Aidyn's predictor-book alias,
    // and the highest possible index, which aliases sample memory.
      for (const [segment, slot] of [[0x0f000000, 0x35c], [AIDYN_SEGMENT, AIDYN_BASE_SLOT], [0xff000000, 0x71c]]) {
        const audio = fixture(Audio);
        const LOAD_BASE = 0x1000, SAVE_BASE = 0x1800, OFFSET = 0x28;
        const payload = Uint8Array.from({ length: TRANSFER_BYTES }, (_, i) => i + 1);
        audio.view.setUint32(slot, LOAD_BASE);
        audio.ram.set(payload, LOAD_BASE + OFFSET);
        audio.execute(OP_LOAD, segment | OFFSET);
        expect(audio.dmem.slice(INPUT, INPUT + TRANSFER_BYTES)).toEqual(payload);

        audio.dmem.copyWithin(OUTPUT, INPUT, INPUT + TRANSFER_BYTES);
        audio.view.setUint32(slot, SAVE_BASE);
        audio.execute(OP_SAVE, segment | OFFSET);
        expect(audio.ram.slice(SAVE_BASE + OFFSET, SAVE_BASE + OFFSET + TRANSFER_BYTES)).toEqual(payload);
        expect(audio.view.getUint32(slot)).toBe(SAVE_BASE);
      }
    });

    test('DMA masks the sum to 24 bits, while SETLOOP retains the full 32-bit sum', () => {
      for (const [base, offset, sum, physical] of [
        [0x01001000, 0x20, 0x01001020, 0x1020],
        [0xfffffff0, 0x30, 0x00000020, 0x0020],
        [0x80001000, 0x20, 0x80001020, 0x1020],
      ]) {
        const audio = fixture(Audio);
        audio.view.setUint32(AIDYN_BASE_SLOT, base);
        audio.dmem.fill(0x5a, OUTPUT, OUTPUT + TRANSFER_BYTES);
        audio.execute(OP_SAVE, AIDYN_SEGMENT | offset);
        expect(audio.ram.slice(physical, physical + TRANSFER_BYTES)).toEqual(new Uint8Array(TRANSFER_BYTES).fill(0x5a));
        audio.execute(OP_SET_LOOP, AIDYN_SEGMENT | offset);
        expect(audio.view.getUint32(LOOP_ADDRESS)).toBe(sum);
      }
    });

    test('an aliased base outside RAM still fails and earlier stores can be rolled back', () => {
      const audio = fixture(Audio);
      audio.ram.fill(0x42);
      const before = audio.ram.slice();
      audio.dmem.fill(0x99, OUTPUT, OUTPUT + TRANSFER_BYTES);
      audio.view.setUint32(AIDYN_BASE_SLOT, 0x1000);
      audio.execute(OP_SAVE, AIDYN_SEGMENT);
      audio.view.setUint32(AIDYN_BASE_SLOT, RAM_BYTES);
      expect(() => audio.execute(OP_SAVE, AIDYN_SEGMENT)).toThrow(UnsupportedAudioCommand);
      audio.rollback();
      expect(audio.ram).toEqual(before);
    });

    test('unreviewed SEGMENT writes beyond the conventional table still fall back', () => {
      const audio = fixture(Audio);
      const before = audio.dmem.slice();
      expect(() => audio.execute(OP_SEGMENT, AIDYN_SEGMENT | 0x1000)).toThrow(UnsupportedAudioCommand);
      expect(audio.dmem).toEqual(before);
    });
  });
}
