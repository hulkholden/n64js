import { describe, expect, test } from 'bun:test';
import { TetrisphereAudio } from './audio_tetrisphere.js';
import { GoldenEyeAudio } from './audio_goldeneye.js';
import { DiddyBlastAudio } from './audio_diddy_blast.js';
import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { ABI1Audio } from './audio_abi1.js';
import { UnsupportedAudioCommand } from './audio_base.js';
import { getAudioHLEClass } from './hle_audio.js';

function fixture(Audio = ABI1Audio) {
  return new Audio(new Uint8Array(0x4000), new Uint8Array(4096));
}

function setBuffers(audio, input, output, count) {
  audio.execute(0x08000000 | (input - 0x5c0), ((output - 0x5c0) << 16) | count);
}

function samples(audio, address, count) {
  return Array.from({ length: count }, (_, i) => audio.s16(address + i * 2));
}

for (const Audio of [ABI1Audio, TetrisphereAudio]) describe(`${Audio.name} shared commands`, () => {
  test('DMA resolves segments and rounds both addresses down and size up to eight bytes', () => {
    const a = fixture(Audio);
    a.ram.set(Array.from({ length: 16 }, (_, i) => i + 1), 0x1020);
    a.execute(0x07000000, 0x03001000);
    setBuffers(a, 0x605, 0x705, 9);
    a.execute(0x04000000, 0x03000027);
    expect([...a.dmem.slice(0x600, 0x610)]).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    a.dmem.set(a.dmem.slice(0x600, 0x610), 0x700);
    a.execute(0x06000000, 0x03000047);
    expect([...a.ram.slice(0x1040, 0x1050)]).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  test('DMEMMOVE snapshots sixteen bytes per iteration, including forward overlap', () => {
    const a = fixture(Audio);
    a.dmem.set(Array.from({ length: 48 }, (_, i) => i), 0x600);
    a.execute(0x0a000040, 0x00480020);
    expect([...a.dmem.slice(0x608, 0x618)]).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect([...a.dmem.slice(0x618, 0x628)]).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 29, 30, 31]);
  });

  test('clear rounds up, while zero-count commands preserve samples', () => {
    const a = fixture(Audio); a.dmem.fill(0x7b, 0x600, 0x640);
    a.execute(0x02000040, 17);
    expect([...a.dmem.slice(0x600, 0x620)]).toEqual(Array(32).fill(0));
    expect(a.dmem[0x620]).toBe(0x7b);
    a.execute(0x02000060, 0);
    setBuffers(a, 0x600, 0x620, 0);
    for (const op of [4, 6, 13, 14]) a.execute(op << 24, 0x00400060);
    expect(a.dmem[0x620]).toBe(0x7b);
  });

  test('interleave writes left then right and rounds the per-channel count', () => {
    const a = fixture(Audio);
    for (let i = 0; i < 8; i++) { a.put16(0x600 + i * 2, 10 + i); a.put16(0x700 + i * 2, -10 - i); }
    setBuffers(a, 0x600, 0x800, 1);
    a.execute(0x0d000000, 0x00400140);
    expect(samples(a, 0x800, 16)).toEqual(Array.from({ length: 8 }, (_, i) => [10 + i, -10 - i]).flat());
  });

  test('ADPCM decodes signed nibbles, clamps large scales, and saves the last block', () => {
    for (const scale of [0, 4, 12, 15]) {
      const a = fixture(Audio);
      a.dmem[0x600] = scale << 4;
      a.dmem.fill(0x78, 0x601, 0x609);
      setBuffers(a, 0x600, 0x700, 1);
      a.execute(0x01010000, 0x1000);
      const factor = 2 ** Math.min(scale, 12);
      const result = Array(8).fill([7 * factor, -8 * factor]).flat();
      expect(samples(a, 0x700, 16)).toEqual(Array(16).fill(0));
      expect(samples(a, 0x720, 16)).toEqual(result);
      expect(a.ram.slice(0x1000, 0x1020)).toEqual(a.dmem.slice(0x720, 0x740));
    }
  });

  test('ADPCM loop history has its own address; state writes still use the command address', () => {
    const a = fixture(Audio);
    a.ram.fill(0x37, 0x1100, 0x1120);
    a.execute(0x0f000000, 0x1100);
    setBuffers(a, 0x600, 0x700, 0);
    a.execute(0x01020000, 0x1000);
    expect(a.ram.slice(0x1000, 0x1020)).toEqual(new Uint8Array(32).fill(0x37));
  });

  test('unity resampling preserves four history samples and the continuation fraction', () => {
    const a = fixture(Audio);
    // Synthetic filter: only the first tap is active, for every phase.
    for (let i = 0; i < 64; i++) a.put16(0xc0 + i * 8, 32767);
    for (let i = 0; i < 16; i++) a.put16(0x600 + i * 2, i + 100);
    setBuffers(a, 0x600, 0x700, 16);
    a.execute(0x05018000, 0x1000);
    expect(samples(a, 0x700, 8)).toEqual([0, 0, 0, 0, 100, 101, 102, 103]);
    expect([...a.ram.slice(0x1000, 0x100a)]).toEqual([0, 104, 0, 105, 0, 106, 0, 107, 0, 0]);
    a.execute(0x05008000, 0x1000);
    expect(samples(a, 0x700, 8)).toEqual([104, 105, 106, 107, 100, 101, 102, 103]);
  });

  test('overlapping resampling reads a whole output vector before storing any lane', () => {
    const a = fixture(Audio);
    for (let i = 0; i < 64; i++) a.put16(0xc0 + i * 8, 32767);
    for (let i = 0; i < 16; i++) a.put16(0x600 + i * 2, i + 100);
    setBuffers(a, 0x600, 0x600, 32);
    a.execute(0x05018000, 0x1000);
    // The second vector sees the first vector's stores, but each vector
    // reads all eight source windows before overwriting its own input.
    expect(samples(a, 0x600, 16)).toEqual([
      0, 0, 0, 0, 100, 101, 102, 103,
      100, 101, 102, 103, 108, 109, 110, 111,
    ]);
    expect([...a.ram.slice(0x1000, 0x100a)]).toEqual([0, 108, 0, 109, 0, 110, 0, 111, 0, 0]);
  });

  test('pole filter retains the last two scratch samples on INIT and updates the book', () => {
    const a = fixture(Audio);
    a.put16(0xf94, 1234); a.put16(0xf96, -567);
    a.put16(0x4c0, 16384); a.put16(0x4d0, 8192);
    setBuffers(a, 0x600, 0x700, 16);
    a.execute(0x0e011000, 0x1000);
    expect(a.s16(0x700)).toBe(950); // floor((1234*16384 - 567*8192) / 16384)
    expect(a.s16(0x4d0)).toBe(2048);
    expect(a.ram.slice(0x1000, 0x1008)).toEqual(a.dmem.slice(0x708, 0x710));
  });

  test('envelope initialization saturates the rate product before interpolating lanes', () => {
    const a = fixture(Audio);
    setBuffers(a, 0x600, 0x700, 32);
    a.execute(0x08080240, 0x03400440); // right=800, wet left=900, wet right=a00
    a.execute(0x09067530, 0); a.execute(0x09047530, 0); // initial 30000
    a.execute(0x09027d00, 0x00018000); a.execute(0x09007d00, 0x00018000); // target 32000, rate 1.5
    a.execute(0x09087fff, 0); // dry only
    for (let i = 0; i < 16; i++) a.put16(0x600 + i * 2, 32767);
    a.execute(0x03090000, 0x1000);
    expect(a.s16(0x700)).toBe(30343);
    expect(a.s16(0x800)).toBe(30343);
    expect(samples(a, 0x900, 16)).toEqual(Array(16).fill(0));
    expect(a.ram.slice(0x1000, 0x1050)).toEqual(a.dmem.slice(0xf90, 0xfe0));
  });

  test('envelopes without AUX mix both dry channels and preserve configured wet buffers', () => {
    const a = fixture(Audio);
    setBuffers(a, 0x600, 0x700, 32);
    a.execute(0x08080240, 0x03400440);
    a.execute(0x09064000, 0); a.execute(0x09042000, 0);
    a.execute(0x09024000, 0x00010000); a.execute(0x09002000, 0x00010000);
    a.execute(0x09087fff, 0x7fff);
    for (let i = 0; i < 16; i++) {
      a.put16(0x600 + i * 2, 1000);
      a.put16(0x900 + i * 2, 1234);
      a.put16(0xa00 + i * 2, 5678);
    }
    a.execute(0x03010000, 0x1000);
    expect(samples(a, 0x700, 16)).toEqual(Array(16).fill(500));
    expect(samples(a, 0x800, 16)).toEqual(Array(16).fill(250));
    a.execute(0x03000000, 0x1000);
    expect(samples(a, 0x700, 16)).toEqual(Array(16).fill(1000));
    expect(samples(a, 0x800, 16)).toEqual(Array(16).fill(500));
    expect(samples(a, 0x900, 16)).toEqual(Array(16).fill(1234));
    expect(samples(a, 0xa00, 16)).toEqual(Array(16).fill(5678));
    const state = new DataView(a.ram.buffer, 0x1000, 80);
    expect(Array.from({ length: 40 }, (_, i) => state.getInt16(i * 2))).toEqual([
      ...Array(8).fill(16384), ...Array(8).fill(0), ...Array(8).fill(8192), ...Array(8).fill(0),
      16384, 1, 0, 8192, 1, 0, 32767, 32767,
    ]);
  });

  test('unsupported commands and buffer shapes fail without silently inventing output', () => {
    const a = fixture(Audio);
    expect(() => a.execute(0xff000000, 0)).toThrow(UnsupportedAudioCommand);
    setBuffers(a, 0x600, 0x700, 16);
    expect(() => a.execute(0x03010000, 0x1000)).toThrow(UnsupportedAudioCommand);
    setBuffers(a, 0x600, 0xf80, 64);
    expect(() => a.execute(0x05018000, 0x1000)).toThrow(UnsupportedAudioCommand);
  });

  test('rollback restores overlapping RDRAM writes in reverse order', () => {
    const a = fixture(Audio); a.ram.fill(0x42); a.dmem.fill(0x99, 0x600, 0x640);
    a.dma(0x600, 0x1000, 32, true);
    a.dma(0x610, 0x1010, 32, true);
    a.rollback();
    expect(a.ram).toEqual(new Uint8Array(0x4000).fill(0x42));
  });

  test('retains a grown undo journal and restores overlapping writes across repeated tasks', () => {
    const a = fixture(Audio);
    a.ram.fill(0x42);
    const originalWords = a.undoWords, originalAddresses = a.writeAddresses;
    let words, addresses;
    for (let task = 0; task < 2; task++) {
      for (let i = 0; i < 300; i++) {
        a.dmem.fill(i & 255, 0x600, 0x650);
        a.dma(0x600, 0x1000 + (i % 16) * 8, 80, true);
      }
      if (task === 0) {
        words = a.undoWords; addresses = a.writeAddresses;
        expect(words).not.toBe(originalWords);
        expect(addresses).not.toBe(originalAddresses);
      } else {
        expect(a.undoWords).toBe(words);
        expect(a.writeAddresses).toBe(addresses);
      }
      a.rollback();
      expect(a.ram).toEqual(new Uint8Array(0x4000).fill(0x42));
    }
  });

  test('reuses task storage while refreshing DMEM and rebinding an unaligned RAM view', () => {
    const a = fixture(Audio), previousRam = a.ram, workingDMEM = a.dmem, result = a.result;
    a.dmem.fill(0x99, 0x600, 0x620);
    a.dma(0x600, 0x1000, 32, true);
    a.commit();
    const ram = new Uint8Array(new ArrayBuffer(0x4001), 1), dmem = new Uint8Array(4096).fill(0x77);
    ram.fill(0x42);
    a.reset(ram, dmem);
    dmem[0x600] = 0;
    expect(a.dmem).toBe(workingDMEM);
    expect(a.result).toBe(result);
    expect(a.dmem[0x600]).toBe(0x77);
    a.dma(0x600, 0x1000, 32, true);
    a.rollback();
    expect(ram).toEqual(new Uint8Array(0x4000).fill(0x42));
    expect(previousRam.slice(0x1000, 0x1020)).toEqual(new Uint8Array(32).fill(0x99));
  });

  test('interleave snapshots both source vectors before overlapping stores', () => {
    const a = fixture(Audio);
    for (let i = 0; i < 16; i++) { a.put16(0x600 + i * 2, 100 + i); a.put16(0x700 + i * 2, 200 + i); }
    setBuffers(a, 0x600, 0x600, 32);
    a.execute(0x0d000000, 0x00400140);
    expect(samples(a, 0x600, 32)).toEqual([
      100, 200, 101, 201, 102, 202, 103, 203, 104, 204, 105, 205, 106, 206, 107, 207,
      104, 208, 204, 209, 105, 210, 205, 211, 106, 212, 206, 213, 107, 214, 207, 215,
    ]);
  });
});

describe('ABI1 mixer variants', () => {
  for (const Audio of [ABI1Audio, GoldenEyeAudio, DiddyBlastAudio]) describe(Audio.name, () => {
    test('standard MIXER retains accumulator precision, rounds ties, and saturates the sum', () => {
      const a = fixture(Audio);
      const source = [1000, -1000, 32767, -32768, 1, -1, 1, -1, 32767, -32768, 0, 0, 0, 0, 0, 0];
      const destination = [2000, -2000, 32767, -32768, 0, 0, -1, 1, -32768, 32767, 32767, -32768, 1, -1, 0, 0];
      source.forEach((v, i) => a.put16(0x600 + i * 2, v));
      destination.forEach((v, i) => a.put16(0x700 + i * 2, v));
      setBuffers(a, 0x800, 0x900, 32); // MIXER uses its own packed buffer offsets.
      a.execute(0x0c004000, 0x00400140);
      expect(samples(a, 0x700, 16)).toEqual([2500, -2500, 32767, -32768, 1, 0, 0, 0, -16383, 16382, 32766, -32767, 1, -1, 0, 0]);
      expect(samples(a, 0x600, 16)).toEqual(source);
    });

    test('standard MIXER supports signed gain and in-place samples', () => {
      const a = fixture(Audio);
      [32767, -32768, 10, -10].forEach((v, i) => a.put16(0x600 + i * 2, v));
      setBuffers(a, 0x600, 0x600, 32);
      a.execute(0x0c008000, 0x00400040);
      expect(samples(a, 0x600, 4)).toEqual([-1, 1, 0, 0]);
    });

    test('standard MIXER rounds its count to 32 bytes and skips zero count', () => {
      const a = fixture(Audio);
      for (let i = 0; i < 17; i++) { a.put16(0x600 + i * 2, 1000); a.put16(0x700 + i * 2, 1000); }
      setBuffers(a, 0x600, 0x700, 0);
      a.execute(0x0c004000, 0x00400140);
      expect(samples(a, 0x700, 17)).toEqual(Array(17).fill(1000));
      setBuffers(a, 0x600, 0x700, 1);
      a.execute(0x0c004000, 0x00400140);
      expect(samples(a, 0x700, 17)).toEqual([...Array(16).fill(1500), 1000]);
    });

    test('unreviewed partial mixer overlap is rejected before samples change', () => {
      const a = fixture(Audio); a.dmem.fill(0x5a);
      setBuffers(a, 0x600, 0x610, 32);
      const before = a.dmem.slice();
      expect(() => a.execute(0x0c007fff, 0x00400050)).toThrow(UnsupportedAudioCommand);
      expect(a.dmem).toEqual(before);
    });
  });

  test('Tetrisphere overrides MIXER without changing shared dispatch', () => {
    const a = fixture(TetrisphereAudio); a.dmem.fill(0x5a);
    setBuffers(a, 0x600, 0x700, 32);
    const before = a.dmem.slice();
    a.execute(0x0c007fff, 0x00400140);
    expect(a.dmem).toEqual(before);
    expect(a).toBeInstanceOf(ABI1Audio);
    expect(TetrisphereAudio.prototype.execute).toBe(ABI1Audio.prototype.execute);
  });

  test('handler selection requires an explicitly supported identity', () => {
    expect(getAudioHLEClass('abi1-standard-mixer')).toBe(ABI1Audio);
    expect(getAudioHLEClass('abi1-tetrisphere-us-mixer')).toBe(TetrisphereAudio);
    expect(getAudioHLEClass('abi1-goldeneye-mixer')).toBe(GoldenEyeAudio);
    expect(getAudioHLEClass('abi1-diddy-blast-mixer')).toBe(DiddyBlastAudio);
    for (const identity of ['ABI1', 'unreviewed-audio-program', null]) {
      expect(getAudioHLEClass(identity)).toBeNull();
    }
  });

  test('every reviewed ABI1 identity has an ABI1 handler', () => {
    for (const program of audioMicrocodeManifest.programs) {
      const Audio = getAudioHLEClass(program.id);
      if (program.family === 'ABI1') expect(fixture(Audio)).toBeInstanceOf(ABI1Audio);

    }
  });
});
