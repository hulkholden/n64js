import { describe, expect, test } from 'bun:test';
import { identifyAudioMicrocode, snapshotAudioMicrocode } from './audio_microcode.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { AudioMicrocodeCollector } from '../inventory/audio_microcode_collector.js';

// Synthetic RSP programs: no game binaries or known emulator signature words.
const I = (op, rs, rt, imm) => (op << 26) | (rs << 21) | (rt << 16) | (imm & 0xffff);
const S = (funct, rt, rd, sa = 0) => (rt << 16) | (rd << 11) | (sa << 6) | funct;
const jump = (op, address) => (op << 26) | (address >>> 2);
const put = (bytes, offset, words) => words.forEach((i, n) => new DataView(bytes.buffer).setUint32(offset + n * 4, i));

function program(family = 'ABI1', { loadAddress = 0x1080, tableOffset = 0x70, command = 11, argument = 12, relocation = 0,
  commandBase = 15, commandOffset = 0 } = {}) {
  const code = new Uint8Array(0x1000 - (loadAddress - 0x1000));
  const data = new Uint8Array(0x200);
  const count = family === 'NEAD' ? 24 : 16;
  const table = Array.from({ length: count }, (_, i) => loadAddress + 0x300 + relocation + i * 0x40);
  const dv = new DataView(data.buffer);
  table.forEach((address, index) => dv.setUint16(tableOffset + index * 2, address));
  // Arbitrary registers and table location; parse two words, select a halfword,
  // then jump to it. The table is not identified by its absolute entry values.
  put(code, 0, [I(35, commandBase, command, commandOffset), I(35, commandBase, argument, commandOffset + 4), S(2, command, 7, 23),
    I(12, 7, 7, 0xfe), I(8, 15, 15, 8), I(33, 7, 8, tableOffset), 8 | (8 << 21), 0]);
  const handler = (index, words) => put(code, table[index] - loadAddress, words);
  table.forEach((_, index) => handler(index, [jump(2, loadAddress), 0]));
  if (family !== 'NAUDIO') {
    handler(8, [S(2, argument, 3, 16), I(41, 22, command, 0), I(41, 22, 3, 2), jump(2, loadAddress), I(41, 22, argument, 4)]);
  }
  if (family === 'ABI1') {
    for (const index of [4, 6]) handler(index, [I(37, 22, 4, 4)]);
  } else if (family === 'NAUDIO') {
    for (const index of [4, 6]) handler(index, [S(0, command, 3, 8), S(2, 3, 3, 20), I(12, command, 4, 0xfff)]);
    handler(13, [I(8, 0, 7, 368)]);
    for (const index of [7, 8, 14]) dv.setUint16(tableOffset + index * 2, 0);
  } else if (family === 'NEAD') {
    const decoder = loadAddress + 0xc00;
    for (const index of [20, 21]) handler(index, [jump(3, decoder), 0]);
    put(code, decoder - loadAddress, [S(2, command, 4, 12), I(12, 4, 4, 0xff0)]);
  }
  return { code, data, loadAddress, loader: loadAddress === 0x1000 ? 'direct' : 'rspboot', issues: [], table };
}

function taskImage({ bootAddress = 0x3000, codeAddress = 0x4000, codeSize = 0, dataAddress = 0x6000, dataSize = 0x200 } = {}) {
  const ram = new Uint8Array(0x10000), imem = new Uint8Array(0x1000);
  const task = new MemoryRegion(new ArrayBuffer(64));
  for (const [offset, value] of [[8, bootAddress], [12, 208], [16, codeAddress], [20, codeSize], [24, dataAddress], [28, dataSize]]) task.set32(offset, value);
  put(imem, 0x0c, [I(35, 1, 2, 0x10), I(8, 0, 3, 0xf7f), I(8, 0, 7, 0x1080),
    I(16, 4, 7, 0), I(16, 4, 2, 1 << 11), I(16, 4, 3, 2 << 11)]);
  return { ram, imem, task };
}

describe('audio microcode structure', () => {
  for (const family of ['ABI1', 'NAUDIO', 'NEAD']) {
    for (const loadAddress of [0x1000, 0x1080]) {
      test(`${family}: derives the layout at ${loadAddress.toString(16)} with relocated handlers/registers`, () => {
        for (const options of [{}, { tableOffset: 0x90, command: 26, argument: 25, relocation: 0x20 }]) {
          const image = program(family, { ...options, loadAddress });
          expect(identifyAudioMicrocode(image)).toMatchObject({ family, detection: 'structure', loadAddress });
        }
      });
    }
  }

  test('constant/table data alone cannot identify an ABI', () => {
    const image = program();
    image.code.fill(0);
    expect(identifyAudioMicrocode(image)).toMatchObject({ family: 'Unknown', reason: 'no-command-dispatcher' });
  });

  test('command words can use fixed DMEM addresses or nonzero pointer offsets', () => {
    for (const options of [{ commandBase: 0, commandOffset: 0x2f0 }, { commandOffset: -16 }]) {
      expect(identifyAudioMicrocode(program('NEAD', options)).family).toBe('NEAD');
    }
    const image = program();
    put(image.code, 4, [I(35, 15, 12, 8)]);
    expect(identifyAudioMicrocode(image).family).toBe('Unknown');
  });

  test('n_audio transfers can rely on DMEM wrapping instead of explicitly masking the address', () => {
    const image = program('NAUDIO');
    for (const index of [4, 6]) put(image.code, image.table[index] - image.loadAddress + 8, [I(8, 11, 4, 0x500)]);
    expect(identifyAudioMicrocode(image).family).toBe('NAUDIO');
  });

  test('rejects a dispatcher with the wrong index mask or command word', () => {
    for (const [offset, instruction] of [[12, I(12, 7, 7, 0x7e)], [8, S(2, 10, 7, 23)], [4, I(35, 16, 12, 4)]]) {
      const image = program();
      put(image.code, offset, [instruction]);
      expect(identifyAudioMicrocode(image).family).toBe('Unknown');
    }
  });

  test('invalid handler pointers cannot produce a family match', () => {
    const image = program();
    const dv = new DataView(image.data.buffer);
    for (let i = 0; i < 16; i++) dv.setUint16(0x70 + i * 2, 0x2000);
    expect(identifyAudioMicrocode(image).family).toBe('Unknown');
  });

  test('a new command layout remains unknown while retaining dispatcher evidence', () => {
    const image = program();
    image.code.fill(0, image.table[8] - image.loadAddress, image.table[8] - image.loadAddress + 64);
    expect(identifyAudioMicrocode(image)).toMatchObject({ family: 'Unknown', reason: 'unrecognized-command-layout', evidence: { entries: 16 } });
  });

  test('reports ambiguity instead of choosing the first plausible dispatcher', () => {
    const image = program();
    image.code.copyWithin(0x80, 0, 32);
    expect(identifyAudioMicrocode(image)).toMatchObject({ family: 'Unknown', reason: 'ambiguous-dispatchers' });
  });

  test('rejects missing/truncated images and unsupported loading layouts without throwing', () => {
    const image = program();
    for (const change of [{ code: new Uint8Array(3) }, { data: new Uint8Array(16) }, { issues: ['invalid-data-range'] }, { loadAddress: null }]) {
      expect(identifyAudioMicrocode({ ...image, ...change }).family).toBe('Unknown');
    }
  });
});

describe('audio task images and inventory versions', () => {
  test('derives fixed DMA size from IMEM even with a zero/short declared size or cartridge boot pointer', () => {
    for (const codeSize of [0, 0x800, 0xffffffff]) {
      const { ram, imem, task } = taskImage({ codeSize, bootAddress: 0x10020000 });
      const image = snapshotAudioMicrocode(ram, task, imem);
      expect(image).toMatchObject({ loader: 'rspboot', loadAddress: 0x1080, issues: [] });
      expect(image.code.length).toBe(0xf80);
    }
  });

  test('direct code is captured from the actual IMEM image', () => {
    const { ram, imem, task } = taskImage({ bootAddress: 0x4000 });
    imem.fill(0);
    imem[4000] = 123;
    task.set32(12, 0x1000);
    const image = snapshotAudioMicrocode(ram, task, imem);
    expect(image.loader).toBe('direct');
    expect(image.loadAddress).toBe(0x1000);
    expect(image.code[4000]).toBe(123);
    image.code[4000] = 0;
    expect(imem[4000]).toBe(123);
  });

  test('out-of-RAM and oversized data remain invalid rather than silently truncated', () => {
    for (const options of [{ dataAddress: 0xfff0 }, { dataSize: 0x1001 }, { dataAddress: 0 }, { dataSize: 0 }, { codeAddress: 0xffffff }]) {
      const { ram, imem, task } = taskImage(options);
      expect(identifyAudioMicrocode(snapshotAudioMicrocode(ram, task, imem))).toMatchObject({ family: 'Unknown', detection: 'invalid' });
    }
  });

  test('same family with different reachable code or dispatch data is a different revision', () => {
    const collector = new AudioMicrocodeCollector();
    const image = program();
    collector.observe(image);
    collector.observe(image);
    put(image.code, image.table[5] - image.loadAddress + 4, [I(13, 0, 20, 1)]); // Changed handler delay slot.
    collector.observe(image);
    new DataView(image.data.buffer).setUint16(0x70, image.table[2]);
    collector.observe(image);
    const result = collector.snapshot();
    expect(result.tasks).toBe(4);
    expect(result.microcodes.map(x => x.tasks)).toEqual([2, 1, 1]);
    expect(result.microcodes.every(x => x.family === 'ABI1')).toBe(true);
    expect(new Set(result.microcodes.map(x => x.fingerprint)).size).toBe(3);
    expect(result.microcodes[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('scratch data and unreachable DMA tail bytes do not create spurious revisions', () => {
    const collector = new AudioMicrocodeCollector();
    const image = program();
    collector.observe(image);
    image.code[0xf00] = 123;
    image.data[0x180] = 123;
    collector.observe(image);
    expect(collector.snapshot().microcodes).toHaveLength(1);
    expect(collector.snapshot().microcodes[0].tasks).toBe(2);
  });

  test('revision identity includes both branch paths, called helpers and delay slots', () => {
    const image = program();
    const offset = image.table[9] - image.loadAddress;
    const helper = 0xd80;
    put(image.code, offset, [I(5, 1, 2, 3), 0, jump(2, image.loadAddress), 0,
      jump(3, image.loadAddress + helper), 0, jump(2, image.loadAddress), 0]);
    put(image.code, helper, [8 | (31 << 21), 0]);
    const collector = new AudioMicrocodeCollector();
    collector.observe(image);
    for (const changed of [offset + 12, helper + 4, offset + 4]) {
      put(image.code, changed, [I(13, 0, 20, 1)]);
      collector.observe(image);
    }
    expect(collector.snapshot().microcodes).toHaveLength(4);
    expect(collector.snapshot().microcodes.every(x => x.family === 'ABI1')).toBe(true);
  });

  test('a handler entering another jump\'s delay slot follows its own fallthrough', () => {
    const image = program();
    const offset = image.table[9] - image.loadAddress;
    new DataView(image.data.buffer).setUint16(0x70 + 7 * 2, image.table[9] + 4);
    put(image.code, offset, [jump(2, image.loadAddress), 0, I(13, 0, 20, 1), jump(2, image.loadAddress), 0]);
    const collector = new AudioMicrocodeCollector();
    collector.observe(image);
    put(image.code, offset + 8, [I(13, 0, 20, 2)]);
    collector.observe(image);
    expect(collector.snapshot().microcodes).toHaveLength(2);
  });

  test('unknown and invalid images are observations, distinct from an empty collector', () => {
    const collector = new AudioMicrocodeCollector();
    expect(collector.snapshot()).toEqual({ version: 1, scope: 'task-start', tasks: 0, microcodes: [] });
    const image = program();
    image.code.fill(0);
    collector.observe(image);
    collector.observe({ ...image, issues: ['invalid-data-range'] });
    expect(collector.snapshot().microcodes.map(x => x.detection)).toEqual(['unknown', 'invalid']);
  });
});
