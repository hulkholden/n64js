import { describe, expect, test } from 'bun:test';
import * as decode from './decode_rsp.js';
import { disassembleInstruction } from './disassemble_rsp.js';

describe('RSP instruction decoding', () => {
  test('separates primary, SPECIAL and COP0 fields in a dispatcher and DMA setup', () => {
    const load = 0x8c1902f4; // LW t9, 0x2f4(r0)
    expect([decode.simpleOp(load), decode.rs(load), decode.rt(load), decode.imm(load)])
      .toEqual([decode.OP_LW, decode.GPR_ZERO, 25, 0x2f4]);
    const shift = 0x001a0dc2; // SRL at, k0, 23
    expect([decode.simpleOp(shift), decode.specialOp(shift), decode.rt(shift), decode.rd(shift), decode.sa(shift)])
      .toEqual([decode.OP_SPECIAL, decode.SPECIAL_SRL, 26, 1, 23]);
    const dma = 0x40831000; // MTC0 v1, SP_RD_LEN
    expect([decode.simpleOp(dma), decode.copOp(dma), decode.rt(dma), decode.rd(dma)])
      .toEqual([decode.OP_COP0, decode.COP0_MTC0, 3, decode.COP0_REG_SP_RD_LEN]);
  });

  test('preserves signed scalar displacements and unmasked logical branch targets', () => {
    expect([decode.imms(0x7fff), decode.imms(0x8000), decode.imms(0xffff)]).toEqual([32767, -32768, -1]);
    expect(decode.imm(0xffff)).toBe(65535);
    expect(decode.branchAddress(0x1200, 0x1420fffd)).toBe(0x11f8); // BNE at, r0, -3
    expect(decode.branchAddress(0xffc, 0x10000001)).toBe(0x1004); // Caller applies the IMEM wrap.
    expect(decode.jumpAddress(0x1000, 0x08000490)).toBe(0x1240);
  });

  test('vector arithmetic excludes the COP2 vector flag from the element selector', () => {
    const add = 0x4ac728d0; // VADD v3, v5, v7[2h]
    expect([decode.cop2VD(add), decode.cop2VS(add), decode.cop2VT(add), decode.cop2E(add)]).toEqual([3, 5, 7, 6]);
    expect(decode.cop2DE(add)).toBe(5);
    expect(disassembleInstruction(0x1000, add).disassembly).toBe('VADD      V3 = V5 + V7[2h]');
  });

  test('vector memory uses a separate element field and a signed seven-bit offset', () => {
    const load = 0xca4c25ff; // LQV v12[11], -1(s2); LQV scales the offset by 16.
    expect([decode.vmemBase(load), decode.vmemVT(load), decode.vmemEl(load), decode.vmemOffset(load)])
      .toEqual([18, 12, 11, -1]);
    expect([decode.vmemOffset(0x3f), decode.vmemOffset(0x40)]).toEqual([63, -64]);
    expect(disassembleInstruction(0x1000, load).instruction.memory).toEqual({ reg: 18, offset: -16, mode: 'load' });
  });
});
