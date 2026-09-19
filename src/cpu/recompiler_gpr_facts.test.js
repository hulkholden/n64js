import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import { Fragment, getFragmentMap, lookupFragment } from './fragments.js';
import { FragmentContext, generateCodeForOp } from './recompiler.js';
import { getPerformanceProfile, setPerformanceProfiling } from '../debug/performance_profile.js';
import { SP_STATUS_REG, SP_STATUS_INTR_BREAK } from '../devices/sp.js';
import { MI_INTR_MASK_REG, MI_INTR_SP } from '../devices/mi.js';

const pc = 0x80001000;
const cycles = 16;
const iop = (op, s, t, immediate = 0) => ((op << 26) | (s << 21) | (t << 16) | (immediate & 0xffff)) >>> 0;
const special = (op, s, t, d, shift = 0) => ((s << 21) | (t << 16) | (d << 11) | (shift << 6) | op) >>> 0;

async function fixture(words) {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  n64js.getSyncFlow = () => null;
  const { cpu0: c, hardware: h } = e;
  const step = h.rsp.step;
  function setup(prepare = () => {}) {
    c.reset();
    c.controlCountValue = 0;
    c.opsExecuted = 0;
    c.llBit = 0;
    c.lastControlRegWrite = 0n;
    c.setControlU32(regs.controlStatus, 0x20000000);
    c.cop1ControlChanged();
    h.cpu1.reset();
    h.rsp.reset();
    h.rsp.step = step;
    h.sp_mem.clear();
    h.sp_reg.clear();
    h.mi_reg.clear();
    h.ram.u8.fill(0);
    words.forEach((word, i) => h.ram.set32(0x1000 + i * 4, word));
    c.setRegS32Extend(20, 0x80003000);
    c.pc = pc;
    prepare(c, h);
  }
  function snapshot() {
    expect(e.fatalError()).toBeNull();
    return {
      pc: c.pc, delayPC: c.delayPC, gpr: [...c.gprU64],
      control: [...c.controlRegU64], hi: c.getMultHiU64(), lo: c.getMultLoU64(),
      fpr: [...h.cpu1.regU32], fcsr: h.cpu1.control[31],
      memory: [...h.ram.u8.slice(0x3000, 0x3040)],
      count: c.controlCountValue, ops: c.getOpsExecuted(),
      compare: c.getCyclesUntilEvent('Compare'),
      rspPC: h.rsp.pc, rspRegs: [...h.rsp.gprS32], rspHalted: h.rsp.halted,
      rspMemory: [...h.sp_mem.u8.slice(0, 64)],
      sp: [...h.sp_reg.u8], mi: [...h.mi_reg.u8],
    };
  }
  function train(prepare) {
    setup(prepare);
    for (let i = 0; i < 499; ++i) lookupFragment(pc);
    c.run(cycles);
    const fragment = getFragmentMap().get(pc);
    expect(fragment?.func).toBeFunction();
    return fragment;
  }
  function compare(fragment, prepare, profiled = false, expectCompiled = true) {
    setPerformanceProfiling(false);
    setup(prepare);
    c.run(cycles);
    const interpreted = snapshot();
    setup(prepare);
    getFragmentMap().set(pc, fragment);
    const before = fragment.executionCount;
    setPerformanceProfiling(profiled);
    try {
      c.run(cycles);
      if (expectCompiled) expect(fragment.executionCount).toBeGreaterThan(before);
      expect(snapshot()).toEqual(interpreted);
      return { ...interpreted, profile: getPerformanceProfile() };
    } finally {
      setPerformanceProfiling(false);
    }
  }
  return { e, train, compare };
}

function generated(words, ctx = new FragmentContext(), fragment = new Fragment(pc)) {
  n64js.getSyncFlow = () => null;
  words.forEach((word, index) => {
    fragment.opsCompiled++;
    const addr = pc + 4 * index;
    ctx.set(fragment, addr, word, addr + 4, addr + 4);
    generateCodeForOp(ctx);
  });
  return fragment.bodyCode;
}

describe('GPR fact generated code', () => {
  test('Mario entry compares both full-width inputs and forwards the stored result', () => {
    const code = generated([special(decode.SPECIAL_SLT, 15, 4, 1), iop(decode.OP_BNEL, 1, 0, -2), iop(decode.OP_LW, 2, 15)]);
    expect(code).toContain('c.getRegS64(15) < c.getRegS64(4)');
    expect(code).toContain('c.setRegU32Extend(1, compare_1 ? 1 : 0)');
    expect(code).toContain('if (compare_1)');
    expect(code).not.toContain('c.getRegU64(1)');
    const afterLoad = generated([iop(decode.OP_LW, 2, 15), special(decode.SPECIAL_SLT, 15, 4, 1)]);
    expect(afterLoad).toContain('c.getRegS64(15) < c.getRegS64(4)');
  });

  test('Zelda word arithmetic proves both SLTU inputs', () => {
    const code = generated([iop(decode.OP_LW, 4, 15, 8), iop(decode.OP_ADDIU, 2, 2, 1), special(decode.SPECIAL_ADDU, 15, 5, 24),
      special(decode.SPECIAL_SLTU, 2, 24, 1), iop(decode.OP_BNEL, 1, 0, -5), iop(decode.OP_SB, 2, 0)]);
    expect(code).toContain('c.getRegU32Lo(2) < c.getRegU32Lo(24)');
    expect(code).toContain('if (compare_4)');
  });

  test('Diddy ANDI allows a Number equality even after a gap', () => {
    const code = generated([iop(decode.OP_LH, 20, 3), special(decode.SPECIAL_AND, 3, 4, 3), iop(decode.OP_ANDI, 3, 3, 0xffff), 0, iop(decode.OP_BEQ, 3, 0, 2)]);
    expect(code).toContain('c.getRegU32Lo(3) === 0');
  });

  test('overwrites and unknown effects kill proofs and forwarding', () => {
    for (const overwrite of [iop(decode.OP_LD, 20, 1), special(decode.SPECIAL_DADDU, 4, 5, 1), iop(decode.OP_DADDIU, 4, 1, 1),
      iop(decode.OP_LDL, 20, 1), iop(decode.OP_LDR, 20, 1), special(decode.SPECIAL_MFHI, 0, 0, 1),
      0x44210000, 0x0000000f]) {
      const code = generated([special(decode.SPECIAL_SLT, 4, 5, 1), overwrite, iop(decode.OP_BNE, 1, 0, 2)]);
      expect(code).toContain('c.getRegU64(1) !== 0n');
    }
  });

  test('a nonadjacent comparison uses its width but not the old local', () => {
    const code = generated([special(decode.SPECIAL_SLT, 4, 5, 1), 0, iop(decode.OP_BNE, 1, 0, 2)]);
    expect(code).toContain('c.getRegS32Lo(1) !== 0');
  });

  test('facts reset on fragment changes, explicit starts and invalidation/rebuilds', () => {
    const ctx = new FragmentContext();
    const fragment = new Fragment(pc);
    generated([iop(decode.OP_ADDIU, 0, 1, 1)], ctx, fragment);
    fragment.invalidate();
    expect(generated([iop(decode.OP_BNE, 1, 0, 2)], ctx, fragment)).toContain('c.getRegU64(1) !== 0n');
    generated([iop(decode.OP_ADDIU, 0, 1, 1)], ctx, fragment);
    expect(generated([iop(decode.OP_BNE, 1, 0, 2)], ctx)).toContain('c.getRegU64(1) !== 0n');
    ctx.newFragment();
    expect(ctx.gprFacts.get(1).kind).toBe('unknown64');
    expect(ctx.gprFacts.get(0).value).toBe(0n);
  });
});

describe('mixed-width compiled/interpreted comparisons', () => {
  const values = [0n, 1n, -1n, 0x7fffffffn, 0x80000000n, -0x80000000n, 0xffffffffn,
    0x100000000n, 0x100000001n, -0x100000000n, 0x7fffffffffffffffn, -0x8000000000000000n];
  for (const [name, prefix] of [
    ['unknown', []],
    ['signed words', [iop(decode.OP_ADDIU, 4, 4), iop(decode.OP_ADDIU, 5, 5)]],
    ['unsigned words', [iop(decode.OP_LWU, 20, 4), iop(decode.OP_LWU, 20, 5, 8)]],
    ['signed/unsigned', [iop(decode.OP_ADDIU, 4, 4), iop(decode.OP_LWU, 20, 5, 8)]],
    ['unsigned/signed', [iop(decode.OP_LWU, 20, 4), iop(decode.OP_ADDIU, 5, 5)]],
  ]) {
    test(`${name}: signed and unsigned ordering, equality, aliases and high words`, async () => {
      // BEQ skips the aliased write to r4, making equality (including differing
      // upper words) observable independently of the comparison-result GPRs.
      const f = await fixture([...prefix, special(decode.SPECIAL_SLT, 4, 5, 1), iop(decode.OP_BNE, 1, 0, 1),
        iop(decode.OP_SW, 20, 1), special(decode.SPECIAL_SLTU, 4, 5, 2), iop(decode.OP_BEQ, 4, 5, 2), iop(decode.OP_SW, 20, 2, 4),
        special(decode.SPECIAL_SLT, 4, 5, 4), special(decode.SPECIAL_SLTU, 5, 5, 5), special(decode.SPECIAL_SLT, 4, 5, 0)]);
      const fragment = f.train();
      for (const s of values) for (const t of values) {
        f.compare(fragment, (c, h) => {
          c.setRegU64(4, s); c.setRegU64(5, t);
          h.ram.set32(0x3000, Number(BigInt.asUintN(32, s)));
          h.ram.set32(0x3008, Number(BigInt.asUintN(32, t)));
        });
      }
    });
  }

  for (const unsigned of [false, true]) {
    for (const immediate of [-32768, -1, 0, 1, 32767]) {
      test(`SLTI${unsigned ? 'U' : ''} immediate ${immediate}`, async () => {
        const op = unsigned ? decode.OP_SLTIU : decode.OP_SLTI;
        const f = await fixture([iop(op, 4, 1, immediate), iop(decode.OP_ADDIU, 4, 4), iop(op, 4, 2, immediate),
          iop(decode.OP_LWU, 20, 4), iop(op, 4, 4, immediate), iop(decode.OP_BNE, 4, 0, 1), iop(decode.OP_SW, 20, 4, 4)]);
        const fragment = f.train();
        for (const value of values) f.compare(fragment, (c, h) => {
          c.setRegU64(4, value);
          h.ram.set32(0x3000, Number(BigInt.asUintN(32, value)));
        });
      });
    }
  }

  test('overflow, constants, mixed-width overwrites and full-source SRA/SRAV', async () => {
    for (const shift of [special(decode.SPECIAL_SRA, 0, 4, 4, 4), special(decode.SPECIAL_SRAV, 6, 4, 4)]) {
      const words = [iop(decode.OP_LUI, 0, 1, 0x8000), iop(decode.OP_ADDIU, 1, 1, -1), iop(decode.OP_ADDIU, 5, 5, 1),
        special(decode.SPECIAL_SLT, 1, 5, 2), iop(decode.OP_LD, 20, 1), special(decode.SPECIAL_SLT, 1, 5, 3),
        shift, special(decode.SPECIAL_SLT, 4, 5, 7), iop(decode.OP_ANDI, 1, 1, 0xffff), iop(decode.OP_BEQ, 1, 0, 1),
        iop(decode.OP_SW, 20, 7, 16)];
      const f = await fixture(words);
      const fragment = f.train();
      for (const value of values) f.compare(fragment, (c, h) => {
        c.setRegU64(4, value); c.setRegU64(5, value); c.setRegS32Extend(6, 4);
        h.ram.set64(0x3000, 0x100000000n);
      });
    }
  });

  test('load and bitwise transfer rules handle sign bits and overwritten constants', async () => {
    for (const load of [decode.OP_LB, decode.OP_LH, decode.OP_LWL, decode.OP_LW, decode.OP_LBU, decode.OP_LHU, decode.OP_LWR, decode.OP_LWU, decode.OP_LL]) {
      for (const bitwise of [decode.SPECIAL_AND, decode.SPECIAL_OR, decode.SPECIAL_XOR]) {
        const f = await fixture([iop(decode.OP_LUI, 0, 1, 0x8000), iop(load, 20, 1), iop(decode.OP_ADDIU, 5, 5),
          special(bitwise, 1, 5, 2), special(decode.SPECIAL_SLT, 2, 5, 3), special(decode.SPECIAL_SLTU, 2, 5, 4),
          iop(decode.OP_ANDI, 2, 2, 0xffff), iop(decode.OP_ORI, 2, 2, 0x8000), iop(decode.OP_XORI, 2, 2, 0xffff),
          iop(decode.OP_SLTIU, 2, 6, -1), iop(decode.OP_BNE, 2, 0, 1), iop(decode.OP_SW, 20, 6, 16)]);
        const fragment = f.train();
        for (const value of values) f.compare(fragment, (c, h) => {
          c.setRegU64(5, value);
          h.ram.set32(0x3000, Number(BigInt.asUintN(32, value)));
        });
      }
    }
  });

  test('word immediates and move/clear specializations preserve comparison facts', async () => {
    for (const load of [decode.OP_LW, decode.OP_LWU, decode.OP_LD]) { // Signed word, unsigned word, full width.
      for (const move of [special(decode.SPECIAL_OR, 4, 0, 6), special(decode.SPECIAL_OR, 0, 4, 6),
        special(decode.SPECIAL_OR, 4, 0, 4), special(decode.SPECIAL_OR, 0, 0, 6), special(decode.SPECIAL_OR, 4, 0, 0)]) {
        const f = await fixture([iop(load, 20, 4), move,
          iop(decode.OP_ORI, 6, 6, 0xffff), iop(decode.OP_XORI, 6, 6, 0x8000),
          special(decode.SPECIAL_SLT, 4, 6, 8), special(decode.SPECIAL_SLTU, 4, 6, 9),
          iop(decode.OP_ANDI, 4, 4, 0xffff), special(decode.SPECIAL_SLT, 4, 6, 10), special(decode.SPECIAL_SLTU, 4, 6, 11),
          iop(decode.OP_BNE, 11, 0, 1), iop(decode.OP_SW, 20, 6, 16)]);
        const fragment = f.train();
        for (const value of values) f.compare(fragment, (c, h) => {
          c.setRegU64(6, value ^ 0xffff000080000000n);
          h.ram.set64(0x3000, value);
        });
      }
    }
  });

  for (const branch of [decode.OP_BEQ, decode.OP_BNE, decode.OP_BEQL, decode.OP_BNEL]) {
    for (const reversed of [false, true]) {
      test(`branch ${branch.toString(16)}, zero ${reversed ? 'first' : 'second'}: off-trace exits, annulment and active RSP`, async () => {
        const f = await fixture([special(decode.SPECIAL_SLT, 4, 5, 1), iop(branch, reversed ? 0 : 1, reversed ? 1 : 0, 2),
          iop(decode.OP_SW, 20, 1), iop(decode.OP_ADDIU, 0, 8, 17), iop(decode.OP_ADDIU, 0, 9, 23)]);
        const fragment = f.train(c => { c.setRegS32Extend(4, 1); });
        for (const value of [-1n, 1n]) f.compare(fragment, (c, h) => {
          c.setRegU64(4, value);
          for (let i = 0; i < 32; i++) h.rsp.imemDV.setUint32(i * 4, iop(decode.OP_ADDIU, 1, 1, 1), false);
          h.rsp.halted = false;
        });
      });
    }
  }

  for (const profiled of [false, true]) {
    test(`RSP interrupt between comparison and branch materializes the exact prefix, profiling=${profiled}`, async () => {
      const f = await fixture([special(decode.SPECIAL_SLT, 4, 5, 1), iop(decode.OP_BNE, 1, 0, 2), iop(decode.OP_SW, 20, 1)]);
      const fragment = f.train();
      const result = f.compare(fragment, (c, h) => {
        c.setRegS32Extend(4, -1);
        c.setControlU32(regs.controlStatus, 0x20000401);
        c.statusRegisterChanged();
        h.mi_reg.set32(MI_INTR_MASK_REG, MI_INTR_SP);
        h.sp_reg.set32(SP_STATUS_REG, SP_STATUS_INTR_BREAK);
        h.rsp.imemDV.setUint32(0, iop(decode.OP_ADDIU, 1, 1, 1), false);
        h.rsp.imemDV.setUint32(4, 0x0d, false); // BREAK before CPU branch.
        h.rsp.halted = false;
      }, profiled);
      expect(result.gpr[1]).toBe(1n);
      expect(BigInt.asUintN(32, result.control[regs.controlEPC])).toBe(BigInt(pc + 4));
      expect(result.count).toBe(cycles);
      expect(result.memory.slice(0, 4)).toEqual([0, 0, 0, 0]);
      if (profiled) expect(result.profile.compiledOps).toBe(1);
    });

    test(`delay-slot exception after a forwarded branch, profiling=${profiled}`, async () => {
      const f = await fixture([special(decode.SPECIAL_SLT, 4, 5, 1), iop(decode.OP_BNE, 1, 0, 2), iop(decode.OP_LW, 20, 2)]);
      const fragment = f.train(c => c.setRegS32Extend(4, -1));
      const result = f.compare(fragment, c => {
        c.setRegS32Extend(4, -1); c.setRegS32Extend(20, 0x80003001);
      }, profiled);
      expect(result.gpr[1]).toBe(1n);
      expect(Number(result.control[regs.controlCause]) >>> 0).toBe(0x80000010);
      expect(BigInt.asUintN(32, result.control[regs.controlEPC])).toBe(BigInt(pc + 4));
      if (profiled) expect(result.profile.compiledOps).toBe(3);
    });
  }

  test('an event deadline between comparison and branch falls back with the same visible result', async () => {
    const f = await fixture([special(decode.SPECIAL_SLT, 4, 5, 1), iop(decode.OP_BNE, 1, 0, 2), iop(decode.OP_SW, 20, 1)]);
    const fragment = f.train();
    const result = f.compare(fragment, c => {
      c.setRegS32Extend(4, -1);
      c.addEvent('Stop after comparison', 1, () => c.breakExecution());
    }, false, false);
    expect(result.gpr[1]).toBe(1n);
    expect(result.pc).toBe(pc + 4);
    expect(result.count).toBe(1);
  });
});
