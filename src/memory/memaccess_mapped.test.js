import { beforeEach, describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import * as regs from '../cpu/cpu0reg.js';
import { EmulatedException } from '../cpu/emulated_exception.js';
import * as memory from './memaccess.js';

const { Hardware } = await import('../hardware.js');
const { initCPU } = await import('../cpu/r4300.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const cpu = hardware.cpu0;

beforeEach(() => {
  initCPU(hardware);
  cpu.reset();
  cpu.setControlU32(regs.controlStatus, 0);
  hardware.miRegDevice.reset();
  const dv = hardware.ram.dataView;
  for (let i = 0; i < dv.byteLength; i += 4) {
    dv.setUint32(i, Math.imul(i ^ 0x83f12795, 0x9e3779b1));
  }
});

const loads = [
  ['loadU8fast', 'readU8', 0], ['loadS8fast', 'readU8', 0, 24],
  ['loadU16fast', 'readU16', 1], ['loadS16fast', 'readU16', 1, 16],
  ['loadU32fast', 'readU32', 3], ['loadS32fast', 'readU32', 3, 0],
  ['loadU64fast', 'readU64', 7], ['loadS32slow', 'readU32', 3, 0],
];
const stores = [
  ['store8fast', 'write8', 0], ['store16fast', 'write16', 1],
  ['store32fast', 'write32', 3], ['store64fast', 'write64', 7],
];

function map(index, address, lo0, lo1, mask = 0) {
  cpu.tlbEntries[index].update(index, mask, BigInt(address | 0), lo0, lo1);
}

describe('mapped memory handlers', () => {
  for (const pageMask of [0, 0x6000, 0x1e000, 0x7e000, 0x1fe000, 0x7fe000, 0x1ffe000]) {
    test(`matches device dispatch for page mask ${pageMask.toString(16)}`, () => {
      for (const base of [0x10000000, 0xc0000000, 0xe0000000]) {
        map(base >>> 28, base, 7, 0x10007, 0x7fe000);
      }
      const control = cpu.controlRegU64.slice();
      function outcome(operation, address, viaDevice, value) {
        const [method, deviceMethod, alignment, signShift] = operation;
        cpu.controlRegU64.set(control);
        cpu.pc = 0x80001004;
        cpu.nextPC = 0x80001008;
        cpu.delayPC = 0x80002000;
        let result;
        try {
          if (viaDevice) {
            // The original slow path: alignment fault, device dispatch, then
            // sign extension. Exercise the real device and CPU translator.
            const addr = address >>> 0;
            if (addr & alignment) {
              if (method.startsWith('store')) {
                cpu.unalignedStore(addr);
              } else {
                cpu.unalignedLoad(addr);
              }
            }
            result = hardware.memMap.getMemoryHandler(addr)[deviceMethod](addr, value);
            if (signShift !== undefined) {
              result = (result << signShift) >> signShift;
            }
          } else {
            result = memory[method](address, value);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(EmulatedException);
          result = error.msg;
        }
        return { result, control: [...cpu.controlRegU64], pc: cpu.pc, nextPC: cpu.nextPC, delayPC: cpu.delayPC };
      }

      // Invalid, read-only and writable pages, with physical addresses above
      // 8 MiB to check that the existing mapped-device wrap is preserved.
      for (const flags of [1, 3, 7]) {
        map(2, 0x12000012, 0x20080 | flags, 0x20400 | flags, pageMask);
        control[regs.controlEntryHi] = 0x12n;
        const half = cpu.tlbEntries[2].checkbit;
        const addresses = [0x10000000, 0xc0001000, 0xe0001000, 0x12000000,
          0x12000000 + half - 8, 0x12000000 + half, 0x12000000 + half * 2 - 8,
          0x24000000, 0x80000000, 0x807ffff8, 0xa0000000, 0xa07ffff8, 0xa4001ff8];
        const writes = [];
        for (const address of addresses) {
          for (const offset of [0, 1, 2, 4, 7]) {
            const addr = (address + offset) | 0;
            for (const operation of loads) {
              // Instruction fetch passes an unsigned address to the slow helper.
              const loadAddr = operation[0] === 'loadS32slow' ? addr >>> 0 : addr;
              expect(outcome(operation, loadAddr, false)).toEqual(outcome(operation, loadAddr, true));
            }
            for (const operation of stores) {
              writes.push([operation, addr, operation[2] === 7 ? 0xfedcba9876543210n : 0x89abcdef]);
            }
          }
        }
        const regions = [hardware.ram, hardware.sp_mem];
        const before = regions.map(region => region.u8.slice());
        const expected = writes.map(([op, addr, value]) => outcome(op, addr, true, value));
        const after = regions.map(region => region.u8.slice());
        regions.forEach((region, i) => region.u8.set(before[i]));
        writes.forEach(([op, addr, value], i) => {
          expect(outcome(op, addr, false, value)).toEqual(expected[i]);
        });
        regions.forEach((region, i) => {
          expect(Buffer.compare(region.u8, after[i])).toBe(0);
        });

        // Replacing a warm entry and changing ASID must affect the handlers.
        map(2, 0x12000012, 0x86, 0xc6, pageMask);
        for (const asid of [0x12n, 0x34n, 0x12n]) {
          control[regs.controlEntryHi] = asid;
          for (const operation of [...loads, ...stores]) {
            const value = operation[2] === 7 ? 0x1234n : 0x1234;
            expect(outcome(operation, 0x12000000, false, value))
              .toEqual(outcome(operation, 0x12000000, true, value));
          }
        }
      }
    });
  }
});
