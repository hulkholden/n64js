import { describe, expect, test } from 'bun:test';
import { DiddyBlastAudio } from './audio_diddy_blast.js';

function fixture() {
  const a = new DiddyBlastAudio(new Uint8Array(0x4000), new Uint8Array(4096));
  a.execute(0x08000040, 0x01400010); // input=600, output=700, eight samples
  return a;
}

describe('Diddy/Blast resampler table', () => {
  test('uses the relocated phase-zero coefficients', () => {
    const a = fixture();
    a.put16(0xd0, 16384); // Synthetic filter with a single half-gain first tap.
    for (let i = 0; i < 16; i++) a.put16(0x600 + i * 2, 100 + i);
    a.execute(0x05018000, 0x1000);
    expect(Array.from({ length: 8 }, (_, i) => a.s16(0x700 + i * 2)))
      .toEqual([0, 0, 0, 0, 50, 51, 51, 52]);
  });

  test('reads the last phase from task DMEM and refreshes coefficients when reused', () => {
    const a = fixture(), state = new DataView(a.ram.buffer);
    for (let i = 0; i < 4; i++) state.setInt16(0x1000 + i * 2, (i + 1) * 100);
    state.setUint16(0x1008, 63 << 10);
    a.put16(0xd0 + 63 * 8 + 6, 16384); // Only the fourth history sample contributes.
    const dmem = a.dmem.slice();
    a.execute(0x05000000, 0x1000);
    expect(Array.from({ length: 8 }, (_, i) => a.s16(0x700 + i * 2))).toEqual(Array(8).fill(200));
    a.reset(a.ram, dmem);
    a.put16(0xd0 + 63 * 8 + 6, -16384);
    a.execute(0x05000000, 0x1000);
    expect(Array.from({ length: 8 }, (_, i) => a.s16(0x700 + i * 2))).toEqual(Array(8).fill(-200));
  });
});
