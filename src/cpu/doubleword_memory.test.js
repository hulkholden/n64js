import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import { OP_LD, OP_SD, OP_LDC1, OP_SDC1 } from './decode.js';
import { Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';

const pc = 0x80001000;
const value = 0x89abcdef76543210n;
let emulator, cpu, hardware;

beforeEach(async () => {
  emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  ({ cpu0: cpu, hardware } = emulator);
  cpu.reset();
  cpu.setControlU32(regs.controlStatus, 0);
  n64js.getSyncFlow = () => null;
});

function execute(compiled, opcode, rt = 2, base = 4, offset = 0, delaySlot = false) {
  cpu.pc = pc;
  cpu.delayPC = delaySlot ? pc + 0x100 : null;
  cpu.nextPC = cpu.delayPC ?? pc + 4;
  const word = ((opcode << 26) | (base << 21) | (rt << 16) | (offset & 0xffff)) >>> 0;
  if (compiled) {
    const fragment = new Fragment(pc);
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, pc, word, cpu.nextPC, cpu.nextPC);
    generateCodeForOp(ctx);
    new Function('c', fragment.bodyCode)(cpu);
  } else {
    n64js.executeOp(word);
  }
}

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} doubleword memory`, () => {
    test('copies all 64 bits in big-endian order at both RAM boundaries', () => {
      for (const address of [0x80000000, 0x80003000, 0x807ffff8, 0xa0003000]) {
        const physical = address & 0x7fffff;
        for (const bits of [0n, value, 0x7654321089abcdefn, 0xffffffffffffffffn, 0x8000000000000000n]) {
          cpu.setRegS32Extend(4, address + 8);
          cpu.setRegU64(2, bits);
          execute(compiled, OP_SD, 2, 4, -8);
          expect(hardware.ram.dataView.getBigUint64(physical, false)).toBe(bits);
          cpu.setRegU64(2, ~bits);
          execute(compiled, OP_LD, 2, 4, -8);
          expect(cpu.getRegU64(2)).toBe(bits);
        }
      }
    });

    test('resolves an aliased base before loading and respects register zero', () => {
      hardware.ram.dataView.setBigUint64(0x3000, value, false);
      cpu.setRegS32Extend(4, 0x80003008);
      execute(compiled, OP_LD, 4, 4, -8);
      expect(cpu.getRegU64(4)).toBe(value);
      cpu.setRegS32Extend(4, 0x80003000);
      execute(compiled, OP_LD, 0);
      expect(cpu.getRegU64(0)).toBe(0n);
      expect(hardware.ram.dataView.getBigUint64(0x3000, false)).toBe(value);
      execute(compiled, OP_SD, 0);
      expect(hardware.ram.dataView.getBigUint64(0x3000, false)).toBe(0n);
    });

    test('the first address beyond cached RAM uses the memory handler', () => {
      const read = spyOn(hardware.invalidCachedMemDevice, 'readU64').mockReturnValue(value);
      const write = spyOn(hardware.invalidCachedMemDevice, 'write64').mockImplementation(() => {});
      try {
        cpu.setControlU32(regs.controlStatus, 0x24000000);
        cpu.statusRegisterChanged();
        cpu.setRegS32Extend(4, 0x80800000);
        execute(compiled, OP_LD);
        expect(cpu.getRegU64(2)).toBe(value);
        execute(compiled, OP_SD);
        execute(compiled, OP_LDC1, 0);
        expect(hardware.cpu1.regU64[0]).toBe(value);
        execute(compiled, OP_SDC1, 0);
        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenLastCalledWith(0x80800000);
        expect(write).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenLastCalledWith(0x80800000, value);
      } finally {
        read.mockRestore();
        write.mockRestore();
      }
    });

    test('retains single doubleword device transactions, including loads into zero', () => {
      const read = spyOn(hardware.miRegDevice, 'readU64').mockReturnValue(value);
      const write = spyOn(hardware.miRegDevice, 'write64').mockImplementation(() => {});
      try {
        cpu.setRegS32Extend(4, 0xa4300000);
        execute(compiled, OP_LD);
        expect(cpu.getRegU64(2)).toBe(value);
        execute(compiled, OP_SD);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(0xa4300000, value);
        execute(compiled, OP_LD, 0);
        expect(read).toHaveBeenCalledTimes(2);
        expect(read).toHaveBeenLastCalledWith(0xa4300000);
        expect(cpu.getRegU64(0)).toBe(0n);
      } finally {
        read.mockRestore();
        write.mockRestore();
      }
    });

    test('loads and stores through a mapped TLB page', () => {
      cpu.setControlU32(regs.controlIndex, 0);
      cpu.setControlU32(regs.controlPageMask, 0);
      cpu.setControlU32(regs.controlEntryHi, 0x00402000);
      cpu.setControlU32(regs.controlEntryLo0, (0x2000 >>> 6) | 7);
      cpu.setControlU32(regs.controlEntryLo1, (0x3000 >>> 6) | 7);
      cpu.tlbWriteIndex();
      cpu.setRegS32Extend(4, 0x00403000);
      cpu.setRegU64(2, value);
      execute(compiled, OP_SD);
      expect(hardware.ram.dataView.getBigUint64(0x3000, false)).toBe(value);
      cpu.setRegU64(2, 0n);
      execute(compiled, OP_LD);
      expect(cpu.getRegU64(2)).toBe(value);
    });

    for (const [name, opcode, alignmentCause, tlbCause] of [['LD', OP_LD, 0x10, 0x08], ['SD', OP_SD, 0x14, 0x0c]]) {
      for (const delaySlot of [false, true]) {
        test(`${name} faults before changing memory or registers${delaySlot ? ' in a delay slot' : ''}`, () => {
          for (const [address, cause] of [[0x80003004, alignmentCause], [0x807ffffc, alignmentCause], [0x00400000, tlbCause]]) {
            cpu.setControlU32(regs.controlStatus, 0);
            cpu.setRegS32Extend(4, address);
            cpu.setRegU64(2, value);
            hardware.ram.u8.fill(0x5a, 0x3000, 0x3010);
            hardware.ram.u8.fill(0x5a, 0x7ffff0);
            expect(() => execute(compiled, opcode, 2, 4, 0, delaySlot)).toThrow();
            expect(cpu.getRegU64(2)).toBe(value);
            expect([...hardware.ram.u8.slice(0x3000, 0x3010)]).toEqual(Array(16).fill(0x5a));
            expect([...hardware.ram.u8.slice(0x7ffff0)]).toEqual(Array(16).fill(0x5a));
            expect(cpu.getControlU32(regs.controlCause) & 0x7c).toBe(cause);
            expect(cpu.getControlU32(regs.controlCause) >>> 31).toBe(delaySlot ? 1 : 0);
            expect(cpu.getControlU32(regs.controlBadVAddr)).toBe(address);
            expect(cpu.getControlU32(regs.controlEPC)).toBe(delaySlot ? pc - 4 : pc);
          }
        });
      }
    }

    test('an unaligned load into zero still raises an address error', () => {
      cpu.setRegS32Extend(4, 0x80003004);
      expect(() => execute(compiled, OP_LD, 0)).toThrow();
      expect(cpu.getControlU32(regs.controlCause) & 0x7c).toBe(0x10);
      expect(cpu.getRegU64(0)).toBe(0n);
    });

    for (const fullMode of [false, true]) {
      test(`COP1 transfers preserve raw NaNs and register mapping with FR=${Number(fullMode)}`, () => {
        cpu.setControlU32(regs.controlStatus, 0x20000000 | (fullMode ? 0x04000000 : 0));
        cpu.statusRegisterChanged();
        for (const address of [0x80000000, 0x80003000, 0x807ffff8, 0xa0003000]) {
          const physical = address & 0x7fffff;
          for (const bits of [value, 0x7ff123456789abcdn, 0xfff987654321abcdn]) {
            for (const ft of [0, 2, 3, 31]) {
              const expectedIndex = fullMode ? ft : ft & ~1;
              hardware.cpu1.regU64.fill(0n);
              hardware.ram.dataView.setBigUint64(physical, bits, false);
              cpu.setRegS32Extend(4, address + 8);
              execute(compiled, OP_LDC1, ft, 4, -8);
              expect([...hardware.cpu1.regU64]).toEqual(Array.from({ length: 32 }, (_, i) => i === expectedIndex ? bits : 0n));
              hardware.ram.dataView.setBigUint64(physical, 0n, false);
              execute(compiled, OP_SDC1, ft, 4, -8);
              expect(hardware.ram.dataView.getBigUint64(physical, false)).toBe(bits);
            }
          }
        }
      });
    }

    test('COP1 device transfers remain single doubleword transactions', () => {
      cpu.setControlU32(regs.controlStatus, 0x24000000);
      cpu.statusRegisterChanged();
      const read = spyOn(hardware.miRegDevice, 'readU64').mockReturnValue(value);
      const write = spyOn(hardware.miRegDevice, 'write64').mockImplementation(() => {});
      try {
        cpu.setRegS32Extend(4, 0xa4300000);
        execute(compiled, OP_LDC1, 0);
        expect(hardware.cpu1.regU64[0]).toBe(value);
        execute(compiled, OP_SDC1, 0);
        expect(read).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledWith(0xa4300000);
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith(0xa4300000, value);
      } finally {
        read.mockRestore();
        write.mockRestore();
      }
    });
  });
}
