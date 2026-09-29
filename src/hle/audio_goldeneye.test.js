import { describe, expect, test } from 'bun:test';
import { ABI1Audio } from './audio_abi1.js';
import { UnsupportedAudioCommand } from './audio_base.js';
import { GoldenEyeAudio } from './audio_goldeneye.js';
import { DiddyBlastAudio } from './audio_diddy_blast.js';

function fixture(Audio, count = 32) {
  const a = new Audio(new Uint8Array(0x4000), new Uint8Array(4096));
  a.execute(0x08000040, 0x01400000 | count); // input=600, left=700
  a.execute(0x08080240, 0x03400440); // right=800, wet left=900, wet right=a00
  a.execute(0x090603e8, 0); a.execute(0x090407d0, 0); // initial 1000 / 2000
  a.execute(0x09027530, 0x00080000); // target 30000, increment +8
  a.execute(0x09000000, 0xfff80000); // target 0, increment -8
  a.execute(0x09087fff, 0x4000);
  for (let i = 0; i < count / 2; i++) a.put16(0x600 + i * 2, 32767);
  return a;
}

function samples(a, p, n = 8) {
  return Array.from({ length: n }, (_, i) => a.s16(p + i * 2));
}

for (const Audio of [GoldenEyeAudio, DiddyBlastAudio]) describe(`${Audio.name} additive envelopes`, () => {
  test('shares ABI1 dispatch and all DSP handlers except envelope progression', () => {
    const a = fixture(Audio);
    expect(a).toBeInstanceOf(ABI1Audio);
    for (const name of ['execute', 'envelope', 'mix', 'adpcm', 'resample', 'poleFilter']) {
      expect(Audio.prototype[name]).toBe(ABI1Audio.prototype[name]);
    }
  });

  test('initializes signed ramps, mixes dry/wet output, and saves the last used lanes', () => {
    const a = fixture(Audio);
    a.execute(0x03090000, 0x1000);
    expect(samples(a, 0x700, 16)).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1007,
      1009, 1010, 1011, 1012, 1013, 1014, 1015, 1015]);
    expect(samples(a, 0x800, 16)).toEqual([1999, 1998, 1997, 1996, 1995, 1994, 1993, 1992,
      1991, 1990, 1989, 1988, 1987, 1986, 1985, 1984]);
    expect(samples(a, 0x900)).toEqual([501, 501, 502, 502, 503, 503, 504, 504]);
    expect(samples(a, 0xa00)).toEqual([1000, 999, 999, 998, 998, 997, 997, 996]);
    const state = new DataView(a.ram.buffer, 0x1000, 80);
    expect(Array.from({ length: 40 }, (_, i) => state.getUint16(i * 2))).toEqual([
      1009, 1010, 1011, 1012, 1013, 1014, 1015, 1015,
      0, 0, 0, 0, 0, 0, 0, 65528,
      1991, 1990, 1989, 1988, 1987, 1986, 1985, 1984,
      0, 0, 0, 0, 0, 0, 0, 8,
      30000, 8, 0, 0, 65528, 0, 32767, 16384,
    ]);
  });

  test('continuation restores saved parameters and advances each channel exactly once per block', () => {
    const a = fixture(Audio);
    a.execute(0x03090000, 0x1000);
    const saved = a.ram.slice(0x1000, 0x1050);
    // Fresh executor and conflicting SETVOL values rule out cached state.
    const b = fixture(Audio, 16);
    b.ram.set(saved, 0x1000);
    b.execute(0x09020000, 0); b.execute(0x09000000, 0);
    b.dmem.fill(0x55, 0x900, 0xa10);
    b.execute(0x03000000, 0x1000); // no AUX
    expect(samples(b, 0x700)).toEqual([1017, 1018, 1019, 1020, 1021, 1022, 1023, 1023]);
    expect(samples(b, 0x800)).toEqual([1983, 1982, 1981, 1980, 1979, 1978, 1977, 1976]);
    expect(b.dmem.slice(0x900, 0xa10)).toEqual(new Uint8Array(0x110).fill(0x55));
  });

  test('initial interpolation saturates both words when the accumulator overflows', () => {
    const a = fixture(Audio), c = a.envelopeChannels[0];
    c.rateHi = 8; c.rateLo = 0;
    a.initializeEnvelope(c, 32767);
    expect([...c.hi]).toEqual(Array(8).fill(32767));
    expect([...c.lo]).toEqual(Array(8).fill(65535));
    c.rateHi = -8;
    a.initializeEnvelope(c, -32768);
    expect([...c.hi]).toEqual(Array(8).fill(-32768));
    expect([...c.lo]).toEqual(Array(8).fill(0));
  });

  test('fractional addition carries before signed saturation and keeps the wrapped fraction', () => {
    const a = fixture(Audio), c = a.envelopeChannels[0];
    c.hi.set([32767, 32767, -32768, -32768, 0, -1, 10, -10]);
    c.lo.set([65535, 0, 65535, 0, 65535, 32768, 0, 32768]);
    c.rateHi = 0; c.rateLo = 32768;
    a.advanceEnvelope(c);
    expect([...c.hi]).toEqual([32767, 32767, -32767, -32768, 1, 0, 10, -9]);
    expect([...c.lo]).toEqual([32767, 32768, 32767, 32768, 32767, 0, 32768, 0]);
    c.rateHi = -32768; c.rateLo = 0;
    a.advanceEnvelope(c);
    expect([...c.hi]).toEqual([-1, -1, -32768, -32768, -32767, -32768, -32758, -32768]);
    expect([...c.lo]).toEqual([32767, 32768, 32767, 32768, 32767, 0, 32768, 0]);
  });

  test('target selection tests the signed high word and retains fractional lanes at the target', () => {
    const a = fixture(Audio);
    a.execute(0x090203ec, 0x00088000); // +8.5, target 1004
    a.execute(0x090007da, 0x00008000); // +0.5, high word zero selects signed maximum
    a.execute(0x03010000, 0x1000);
    expect(samples(a, 0x710)).toEqual(Array(8).fill(1004));
    expect(samples(a, 0x800, 16)).toEqual(Array(16).fill(2010));
    expect(samples(a, 0xf90)).toEqual(Array(8).fill(1004));
    expect(a.u16(0xfa0)).toBe(36864); // 1/8 of 8.5 plus 8.5: fraction 9/16
    expect(a.u16(0xfc0)).toBe(36864); // 1/8 of 0.5 plus 0.5
  });

  test('unreviewed short and overlapping envelopes still fall back', () => {
    const a = fixture(Audio, 16);
    expect(() => a.execute(0x03010000, 0x1000)).toThrow(UnsupportedAudioCommand);
    a.execute(0x08000040, 0x00400020);
    expect(() => a.execute(0x03090000, 0x1000)).toThrow(UnsupportedAudioCommand);
  });
});
