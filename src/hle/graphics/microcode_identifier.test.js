import { describe, expect, test } from 'bun:test';
import { MemoryRegion } from '../../memory/memory_region.js';
import { RSPTask } from '../rsp_task.js';
import { TaskOffsets } from '../rsp_task_constants.js';
import { identifyMicrocode, MicrocodeId, microcodePrefixLength } from './microcode_identifier.js';

describe('microcode identification', () => {
  test('identifies Naboo without selecting the Indiana Jones skip path or GBI0 fallback', () => {
    const hash = 0x1f59be1a;
    for (const version of ['', 'RSP Gfx ucode F3DEX fifo 2.0']) {
      expect(identifyMicrocode(version, hash)).toEqual({
        id: MicrocodeId.F5_NABOO, family: 'F5', variant: 'NABOO', version, hash, detection: 'hash',
      });
    }
    expect(identifyMicrocode('', 0xdd57a04e)).toMatchObject({
      id: MicrocodeId.F5_INDI, variant: 'INDI',
    });
  });

  test('a hash match takes precedence even when its handler ID is zero', () => {
    const version = 'RSP Gfx ucode S2DEX fifo 2.0';
    const hash = 0x313f038b; // Pilotwings selects GBI0 despite the conflicting string.
    expect(identifyMicrocode(version, hash)).toEqual({
      id: MicrocodeId.GBI0, family: 'GBI0', variant: null, version, hash, detection: 'hash',
    });
  });

  test('uses version fragments to identify families when the hash is unknown', () => {
    for (const [version, id, family, variant] of [
      ['RSP Gfx ucode L3DEX 1.23', MicrocodeId.GBI1_L3DEX, 'GBI1', 'L3DEX'],
      ['RSP Gfx ucode L3DEX       fifo 2.04  Yoshitaka Yasumoto 1998 Nintendo.', MicrocodeId.GBI2_L3DEX, 'GBI2', 'L3DEX'],
      ['RSP Gfx ucode L3DEX       fifo 2.07  Yoshitaka Yasumoto 1999 Nintendo.', MicrocodeId.GBI2_L3DEX, 'GBI2', 'L3DEX'],
      ['RSP Gfx ucode L3DEX xbus 2.04', MicrocodeId.GBI2_L3DEX, 'GBI2', 'L3DEX'],
      ['RSP Gfx ucode F3DEX 1.0', MicrocodeId.GBI1, 'GBI1', null],
      ['RSP Gfx ucode F3DEX fifo 2.0', MicrocodeId.GBI2, 'GBI2', null],
      ['RSP Gfx ucode F3DFLX.Rej  fifo 2.03F Yoshitaka Yasumoto 1998 Nintendo.', MicrocodeId.GBI2_FLX, 'GBI2', 'F3DFLX'],
      ['RSP Gfx ucode S2DEX 1.0', MicrocodeId.GBI1_SDEX, 'GBI1', 'S2DEX'],
      ['RSP Gfx ucode S2DEX fifo 2.0', MicrocodeId.GBI2_SDEX, 'GBI2', 'S2DEX'],
      ['RSP ZSortp 0.33', MicrocodeId.ZSORTP, 'ZSortp', null],
    ]) {
      expect(identifyMicrocode(version, 0x12345678)).toMatchObject({
        id, family, variant, detection: 'string',
      });
    }
  });

  test('marks empty and unrecognized versions as GBI0 fallbacks', () => {
    for (const version of ['', 'unrecognized microcode']) {
      expect(identifyMicrocode(version, 0)).toMatchObject({
        id: MicrocodeId.GBI0, family: 'GBI0', variant: null, detection: 'fallback',
      });
    }
  });

  test('identifies HVQM2 SP1 from its stable code prefix despite changing trailing data', () => {
    for (const hash of [0x4ddff97c, 0x63d93f7d]) {
      expect(identifyMicrocode('', hash, 0xeb70fcb5)).toEqual({
        id: MicrocodeId.HVQM2, family: 'HVQM2', variant: 'SP1',
        version: '', hash, detection: 'hash',
      });
      // A matching prefix is required; the mutable full-range hash is not an identity.
      for (const prefix of [null, 0xeb70fcb4]) {
        expect(identifyMicrocode('', hash, prefix)).toMatchObject({
          id: MicrocodeId.GBI0, detection: 'fallback',
        });
      }
    }
  });

  test('identifies BOSS ZSort by hash without confusing it with Nintendo ZSortp', () => {
    const hash = 0xe281945c;
    for (const version of ['', 'RSP ZSortp 0.33', 'RSP Gfx ucode F3DEX fifo 2.0']) {
      expect(identifyMicrocode(version, hash)).toEqual({
        id: MicrocodeId.ZSORT_BOSS, family: 'ZSortBOSS', variant: null, version, hash, detection: 'hash',
      });
    }
  });

  test('evaluates prefixHash lazily only when primary hash and version do not match', () => {
    let prefixCalls = 0;
    const prefixHash = () => {
      prefixCalls++;
      return 0xeb70fcb5;
    };

    // Known hash override: does not call prefixHash.
    expect(identifyMicrocode('', 0x23f92542, prefixHash)).toMatchObject({
      id: MicrocodeId.GBI0_GE, detection: 'hash',
    });
    expect(prefixCalls).toBe(0);

    // Known version string: does not call prefixHash.
    expect(identifyMicrocode('RSP Gfx ucode F3DEX fifo 2.0', 0x12345678, prefixHash)).toMatchObject({
      id: MicrocodeId.GBI2, detection: 'string',
    });
    expect(prefixCalls).toBe(0);

    // Unknown hash and version: calls prefixHash once and identifies HVQM2.
    expect(identifyMicrocode('', 0x12345678, prefixHash)).toMatchObject({
      id: MicrocodeId.HVQM2, detection: 'hash',
    });
    expect(prefixCalls).toBe(1);
  });

  test('RSPTask memoizes version string and microcode hashes until loadUcode', () => {
    const ram = new Uint8Array(0x4000);
    const enc = new TextEncoder();
    const v1 = enc.encode('RSP Gfx ucode F3DEX 1.21\0');
    const v2 = enc.encode('RSP Gfx ucode S2DEX fifo 2.08\0');
    ram.set([1, 2, 3, 4], 0x100);
    ram.set(v1, 0x200);
    ram.set([5, 6, 7, 8], 0x1000);
    ram.set(v2, 0x2000);

    const taskMem = new MemoryRegion(new ArrayBuffer(0x40));
    taskMem.set32(TaskOffsets.ucodePtr, 0x80000100);
    taskMem.set32(TaskOffsets.ucodeSize, 4);
    taskMem.set32(TaskOffsets.ucodeDataPtr, 0x80000200);
    taskMem.set32(TaskOffsets.ucodeDataSize, v1.length);

    let dataReads = 0;
    let codeReads = 0;
    const task = new RSPTask(ram, taskMem);
    const origDataByte = task.dataByte.bind(task);
    const origCodeByte = task.codeByte.bind(task);
    task.dataByte = offset => {
      dataReads++;
      return origDataByte(offset);
    };
    task.codeByte = offset => {
      codeReads++;
      return origCodeByte(offset);
    };

    const version1 = task.detectVersionString();
    expect(version1).toBe('RSP Gfx ucode F3DEX 1.21');
    const firstDataReads = dataReads;
    expect(firstDataReads).toBeGreaterThan(0);
    expect(task.detectVersionString()).toBe(version1);
    expect(dataReads).toBe(firstDataReads);

    const hash1 = task.computeMicrocodeHash();
    expect(codeReads).toBe(4);
    expect(task.computeMicrocodeHash()).toBe(hash1);
    expect(codeReads).toBe(4);

    // Prefix hash on a short task is also memoized without reading bytes.
    expect(task.computeMicrocodeHash(microcodePrefixLength)).toBeNull();
    expect(task.computeMicrocodeHash(microcodePrefixLength)).toBeNull();
    expect(codeReads).toBe(4);

    // A shorter prefix length is computed once and memoized.
    const prefix2 = task.computeMicrocodeHash(2);
    expect(codeReads).toBe(6);
    expect(task.computeMicrocodeHash(2)).toBe(prefix2);
    expect(codeReads).toBe(6);

    // loadUcode invalidates memoized version and hashes.
    task.loadUcode(0x80001000, 4, 0x80002000, v2.length);
    const version2 = task.detectVersionString();
    expect(version2).toBe('RSP Gfx ucode S2DEX fifo 2.08');
    const secondDataReads = dataReads;
    expect(secondDataReads).toBeGreaterThan(firstDataReads);
    expect(task.detectVersionString()).toBe(version2);
    expect(dataReads).toBe(secondDataReads);

    const hash2 = task.computeMicrocodeHash();
    expect(hash2).not.toBe(hash1);
    expect(codeReads).toBe(10);
    expect(task.computeMicrocodeHash()).toBe(hash2);
    expect(codeReads).toBe(10);
  });
});

