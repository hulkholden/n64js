import { beforeEach, describe, expect, test } from 'bun:test';
import '../headless_env.js';
import { MemoryRegion } from '../memory_region.js';
import { initRSP, RSP } from './rsp.js';

let rsp;
beforeEach(() => {
  const hardware = {
    sp_mem: new MemoryRegion(new ArrayBuffer(0x2000)),
    sp_ibist_mem: new MemoryRegion(new ArrayBuffer(8)),
  };
  rsp = hardware.rsp = new RSP(hardware);
  initRSP(hardware);
});

function vectorInstruction(funct, element, vs, vt, vd) {
  return 0x4a00_0000 | (element << 21) | (vt << 16) | (vs << 11) | (vd << 6) | funct;
}

function selectedLane(element, lane) {
  if (element < 2) return lane;
  if (element < 4) return (lane & ~1) | (element & 1);
  if (element < 8) return (lane & ~3) | (element & 3);
  return element & 7;
}

describe('RSP vector dispatch and writeback', () => {
  for (const [name, funct] of [['VMULF', 0x00], ['VMACF', 0x08], ['VMADN', 0x0e]]) {
    for (let element = 0; element < 16; element++) {
      test(`${name} element ${element} handles accumulator limits and aliased destinations`, () => {
        const s = [-32768, 32767, -7, 7, 0, 1200, -300, 1];
        const t = [-32768, 32767, 300, -300, 1, 0, -1, 1234];
        const accumulators = [0x7fff_ffff_ffffn, -0x8000_0000_0000n, 0x7fff_ffffn, -0x8000_0000n, -1n, 1n, 0n, 0x1234_5678_abcdn];
        for (const destination of [0, 15, 31]) {
          for (let lane = 0; lane < 8; lane++) {
            rsp.setVecS16(31, lane, s[lane]);
            rsp.setVecS16(0, lane, t[lane]);
            rsp.setAccS48(lane, accumulators[lane]);
          }
          rsp.VCO = 0xa55a;
          rsp.VCC = 0x5aa5;
          rsp.VCE = 0x81;
          rsp.executeOp(vectorInstruction(funct, element, 31, 0, destination));
          for (let lane = 0; lane < 8; lane++) {
            const left = name === 'VMADN' ? s[lane] & 0xffff : s[lane];
            const product = BigInt(left) * BigInt(t[selectedLane(element, lane)]);
            const value = name === 'VMULF' ? product * 2n + 0x8000n
              : accumulators[lane] + product * (name === 'VMACF' ? 2n : 1n);
            const acc = BigInt.asIntN(48, value);
            const result = name === 'VMADN'
              ? (acc > 0x7fff_ffffn ? 0xffff : acc < -0x8000_0000n ? 0 : Number(acc & 0xffffn))
              : Math.max(-32768, Math.min(32767, Number(acc >> 16n)));
            expect(rsp.getAccS48(lane)).toBe(acc);
            expect(rsp.getVecU16(destination, lane)).toBe(result & 0xffff);
          }
          expect(rsp.VCO).toBe(0xa55a);
          expect(rsp.VCC).toBe(0x5aa5);
          expect(rsp.VCE).toBe(0x81);
        }
      });
    }
  }

  for (const [name, funct, sign] of [['VADD', 0x10, 1], ['VSUB', 0x11, -1]]) {
    for (let element = 0; element < 16; element++) {
      test(`${name} element ${element} preserves aliased sources and accumulator high bits`, () => {
        const s = [32767, -32768, 32760, -32760, 7, -13, 0, -1];
        const t = [1, -1, 32767, -32768, 300, -300, 0, 1234];
        const carry = 0xa5;
        for (const destination of [0, 15, 31]) {
          for (let lane = 0; lane < 8; lane++) {
            rsp.setVecS16(31, lane, s[lane]);
            rsp.setVecS16(0, lane, t[lane]);
            rsp.setAccS48(lane, 0x1234_5678_abcdn);
          }
          rsp.VCO = 0xff00 | carry;
          rsp.VCC = 0x5aa5;
          rsp.VCE = 0x81;
          rsp.executeOp(vectorInstruction(funct, element, 31, 0, destination));
          for (let lane = 0; lane < 8; lane++) {
            const result = s[lane] + sign * (t[selectedLane(element, lane)] + ((carry >>> lane) & 1));
            expect(rsp.getVecS16(destination, lane)).toBe(Math.max(-32768, Math.min(32767, result)));
            expect(rsp.getAccS48(lane)).toBe(0x1234_5678_0000n | BigInt(result & 0xffff));
          }
          expect(rsp.VCO).toBe(0);
          expect(rsp.VCC).toBe(0x5aa5);
          expect(rsp.VCE).toBe(0x81);
        }
      });
    }
  }

  test('temporary writeback preserves byte order and neighbouring registers', () => {
    const bytes = new Uint8Array(rsp.vpr.buffer);
    const temp = new Uint8Array(rsp.vecTemp.buffer);
    temp.set([0x80, 1, 0xff, 2, 0x12, 0x34, 0xab, 0xcd, 9, 10, 11, 12, 13, 14, 15, 16]);
    for (const register of [0, 15, 31]) {
      bytes.fill(0x5a);
      rsp.setVecFromTemp(register);
      expect(Array.from(bytes.slice(register * 16, register * 16 + 16))).toEqual(Array.from(temp.slice(0, 16)));
      expect(bytes.slice(0, register * 16).every(byte => byte === 0x5a)).toBe(true);
      expect(bytes.slice(register * 16 + 16).every(byte => byte === 0x5a)).toBe(true);
      rsp.setVecZero(register);
      expect(bytes.slice(register * 16, register * 16 + 16).every(byte => byte === 0)).toBe(true);
      expect(bytes.slice(0, register * 16).every(byte => byte === 0x5a)).toBe(true);
      expect(bytes.slice(register * 16 + 16).every(byte => byte === 0x5a)).toBe(true);
    }
  });
});

describe('RSP scalar dispatch', () => {
  test('COP2 register and flag transfers remain scalar instructions', () => {
    rsp.setRegU32(4, 0x89ab);
    rsp.setVecS8(31, 0, 0x67);
    // MTC2 at byte 15 discards the second byte; MFC2 wraps to byte zero.
    rsp.executeOp((0x12 << 26) | (4 << 21) | (4 << 16) | (31 << 11) | (15 << 7));
    rsp.executeOp((0x12 << 26) | (5 << 16) | (31 << 11) | (15 << 7));
    expect(rsp.getVecU8(31, 0)).toBe(0x67);
    expect(rsp.getVecU8(31, 15)).toBe(0x89);
    expect(rsp.getRegS32(5)).toBe((0x8967 << 16) >> 16);
    rsp.executeOp((0x12 << 26) | (6 << 21) | (4 << 16)); // CTC2 VCO.
    rsp.executeOp((0x12 << 26) | (2 << 21) | (6 << 16)); // CFC2 VCO.
    expect(rsp.VCO).toBe(0x89ab);
    expect(rsp.getRegS32(6)).toBe((0x89ab << 16) >> 16);
  });

  test('scalar arithmetic, memory and branch delay slots execute through step', () => {
    const program = [
      0x2401_0010, // ADDIU r1, r0, 16.
      0x3402_8001, // ORI r2, r0, 0x8001.
      0xa422_0000, // SH r2, 0(r1).
      0x8423_0000, // LH r3, 0(r1), with sign extension.
      0x1462_0002, // BNE r3, r2, +2.
      0x2404_0007, // ADDIU r4, r0, 7, in the delay slot.
      0x2404_0009, // Skipped.
      0x0044_2821, // ADDU r5, r2, r4 (SPECIAL dispatch).
    ];
    program.forEach((instruction, i) => rsp.imemDV.setUint32(i * 4, instruction));
    rsp.halted = false;
    for (let i = 0; i < 7; i++) rsp.step();
    expect(rsp.getRegS32(3)).toBe(-32767);
    expect(rsp.getRegS32(4)).toBe(7);
    expect(rsp.getRegU32(5)).toBe(0x8008);
    expect(rsp.dmem.getU16(16)).toBe(0x8001);
    expect(rsp.pc).toBe(32);
  });
});
