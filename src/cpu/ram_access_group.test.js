import { expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import * as regs from './cpu0reg.js';
import { CPU1 } from './cpu1.js';
import { Fragment } from './fragments.js';
import { isSigned32 } from './gpr_facts.js';
import { FragmentContext, compileTraceSteps, emitTraceStep, finishCodeGeneration } from './recompiler.js';
import * as decode from './decode.js';

const pc = 0x80001000;
const iop = (op, s, t, immediate = 0) => ((op << 26) | (s << 21) | (t << 16) | (immediate & 0xffff)) >>> 0;
const copMove = (cop, sub, rt, rd) => ((cop << 26) | (sub << 21) | (rt << 16) | (rd << 11)) >>> 0;
const sw = (offset, base = 4, rt = 2) => iop(decode.OP_SW, base, rt, offset);
const lw = (offset, base = 4, rt = 2) => iop(decode.OP_LW, base, rt, offset);
const lwc1 = (offset, base = 4, ft = 2) => iop(decode.OP_LWC1, base, ft, offset);
const swc1 = (offset, base = 4, ft = 2) => iop(decode.OP_SWC1, base, ft, offset);
const ldc1 = (offset, base = 4, ft = 2) => iop(decode.OP_LDC1, base, ft, offset);
const sdc1 = (offset, base = 4, ft = 2) => iop(decode.OP_SDC1, base, ft, offset);

async function generate(words, { finish = true, fragment = new Fragment(pc), ctx = new FragmentContext() } = {}) {
  await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
  if (fragment.opsCompiled === 0 && fragment.bodyCode === '') {
    fragment.bodyCode = 'let rspHalted = rsp.halted;\n';
  }
  for (let i = 0; i < words.length; i++) {
    fragment.opsCompiled++;
    const stepPC = pc + i * 4;
    emitTraceStep(fragment, { pc: stepPC, instruction: words[i], postPC: stepPC + 4, nextPC: stepPC + 4 }, ctx);
  }
  if (finish) {
    finishCodeGeneration(ctx);
  }
  return { code: fragment.bodyCode, fragment, ctx };
}

const wordAddressCases = [
  ['first word', 0x80000000, [0, 4], 0x800000, true],
  ['negative signed offsets', 0x80000010, [-16, -12], 0x800000, true],
  ['signed address boundary', 0x7ffffffc, [4, 8], 0x800000, true],
  ['base outside RAM, offsets inside', 0x80800008, [-16, -12], 0x800000, true],
  ['unaligned base corrected by offsets', 0x80000001, [3, 7], 0x800000, true],
  ['last full word', 0x807ffff8, [0, 4], 0x800000, true],
  ['group crosses RAM end', 0x807ffffc, [0, 4], 0x800000, false],
  ['group crosses RAM start', 0x80000000, [-4, 0], 0x800000, false],
  ['unaligned', 0x80000001, [0, 4], 0x800000, false],
  ['32-bit wraparound', 0xfffffffc, [0, 4], 0x800000, false],
  ['negative offset wraps', 0, [-4, 0], 0x800000, false],
  ['TLB', 0x00400000, [0, 4], 0x800000, false],
  ['uncached RAM', 0xa0000000, [0, 4], 0x800000, false],
  ['MMIO', 0xa4040000, [0, 4], 0x800000, false],
  ['configured 4 MiB end', 0x803ffff8, [0, 4], 0x400000, true],
  ['configured 4 MiB overflow', 0x803ffffc, [0, 4], 0x400000, false],
  ['full access width exceeds view', 0x80000000, [0, 4], 7, false],
  ['view larger than cached mapping', 0x80800000, [0, 4], 0x1000000, false],
];

for (const [name, base, offsets, bytes, hits] of wordAddressCases) {
  test(`guarded SW: ${name}`, async () => {
    const { code } = await generate([0, ...offsets.map(offset => sw(offset))]);
    expect(code).toContain('Guarded RAM SW group (2 stores)');
    const ramDV = new DataView(new ArrayBuffer(bytes));
    const gprS32 = new Int32Array(64);
    gprS32[2 * 2] = 0x12345678;
    gprS32[4 * 2] = base | 0;
    const helpers = [];
    const c = {
      pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
      execSW: (...args) => {
        // Even the first fallback must precede all fast writes.
        expect(new Uint8Array(ramDV.buffer).some(byte => byte !== 0)).toBe(false);
        helpers.push(args);
      },
    };
    let steps = 0;
    new Function('c', 'rsp', code)(c, { halted: false, step() { steps++; } });
    expect(steps).toBe(3);
    expect(c.pc).toBe(pc + 12);
    if (hits) {
      expect(helpers).toEqual([]);
      for (const offset of offsets) {
        const physical = (base + offset + 0x80000000) >>> 0;
        expect([...new Uint8Array(ramDV.buffer, physical, 4)]).toEqual([0x12, 0x34, 0x56, 0x78]);
      }
    } else {
      expect(helpers).toEqual(offsets.map(offset => [2, 4, offset]));
    }
  });

  test(`guarded LW: ${name}`, async () => {
    const { code } = await generate([0, lw(offsets[0], 4, 2), lw(offsets[1], 4, 3)]);
    expect(code).toContain('Guarded RAM LW group (2 loads)');
    const ramDV = new DataView(new ArrayBuffer(bytes));
    if (hits) {
      const phys0 = (base + offsets[0] + 0x80000000) >>> 0;
      const phys1 = (base + offsets[1] + 0x80000000) >>> 0;
      ramDV.setInt32(phys0, 0x12345678, false);
      ramDV.setInt32(phys1, -0x76543210, false);
    }
    const gprS32 = new Int32Array(64);
    gprS32[2 * 2] = 0x55555555;
    gprS32[2 * 2 + 1] = 0x55555555;
    gprS32[3 * 2] = 0x66666666;
    gprS32[3 * 2 + 1] = 0x66666666;
    gprS32[4 * 2] = base | 0;
    const helpers = [];
    const c = {
      pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
      execLW: (...args) => {
        expect(gprS32[2 * 2]).toBe(0x55555555);
        expect(gprS32[3 * 2]).toBe(0x66666666);
        helpers.push(args);
      },
    };
    let steps = 0;
    new Function('c', 'rsp', code)(c, { halted: false, step() { steps++; } });
    expect(steps).toBe(3);
    expect(c.pc).toBe(pc + 12);
    if (hits) {
      expect(helpers).toEqual([]);
      expect(gprS32[2 * 2]).toBe(0x12345678);
      expect(gprS32[2 * 2 + 1]).toBe(0);
      expect(gprS32[3 * 2]).toBe(-0x76543210);
      expect(gprS32[3 * 2 + 1]).toBe(-1);
    } else {
      expect(helpers).toEqual([[2, 4, offsets[0]], [3, 4, offsets[1]]]);
    }
  });
}

test('guarded LW preserves $zero, handles base-clobbering loads, and records signExtended32 facts', async () => {
  // An initial load into the base register clobbers the base immediately and cannot start a multi-load group.
  expect((await generate([0, lw(0, 4, 4), lw(4, 4, 2)])).code).not.toContain('Guarded RAM LW group');

  // A load into $zero and a trailing load that clobbers the base register can both join a group,
  // while any load after the base-clobbering load is flushed out of the group.
  const { code, ctx } = await generate([0, lw(0, 4, 0), lw(4, 4, 2), lw(8, 4, 4), lw(12, 4, 3)]);
  expect(code).toContain('Guarded RAM LW group (3 loads)');
  expect(code).not.toContain('c.gprS32[0] =');
  expect(code).not.toContain('c.gprS32[1] =');
  expect(isSigned32(ctx.gprFacts.get(2))).toBe(true);
  expect(isSigned32(ctx.gprFacts.get(3))).toBe(true);
  expect(isSigned32(ctx.gprFacts.get(4))).toBe(true);

  const ramDV = new DataView(new ArrayBuffer(0x1000));
  ramDV.setInt32(0x100, -1, false);
  ramDV.setInt32(0x104, 0x80000200 | 0, false);
  ramDV.setInt32(0x108, 0x80000300 | 0, false);
  const gprS32 = new Int32Array(64);
  gprS32[4 * 2] = 0x80000100 | 0;
  const trailing = [];
  const c = {
    pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
    execLW: (rt, base, offset) => {
      trailing.push([rt, base, offset, gprS32[base * 2] >>> 0]);
    },
  };
  new Function('c', 'rsp', code)(c, { halted: true, step() {} });
  expect(gprS32[0]).toBe(0);
  expect(gprS32[1]).toBe(0);
  expect(gprS32[2 * 2] >>> 0).toBe(0x80000200);
  expect(gprS32[2 * 2 + 1]).toBe(-1);
  expect(gprS32[4 * 2] >>> 0).toBe(0x80000300);
  expect(gprS32[4 * 2 + 1]).toBe(-1);
  // The fourth LW runs outside the group and sees the newly loaded r4 (0x80000300).
  expect(trailing).toEqual([[3, 4, 12, 0x80000300]]);
});

test('guarded COP1 groups require cop1statusKnown, chain after initial checked access, and respect Status writes', async () => {
  // Without an earlier COP1 op, the first LWC1 is checked (c.execLWC1) and establishes cop1statusKnown,
  // allowing the remaining consecutive LWC1s to form a guarded group.
  const { code: afterChecked, fragment } = await generate([lwc1(0, 4, 0), lwc1(4, 4, 2), lwc1(8, 4, 4)]);
  expect(fragment.usesCop1).toBe(true);
  expect(afterChecked).toContain('c.execLWC1(0, 4, 0)');
  expect(afterChecked).toContain('Guarded RAM LWC1 group (2 loads)');

  // When cop1statusKnown is already true (e.g. after MFC1), all three accesses join the group.
  const { code: allUnchecked } = await generate([
    copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
    lwc1(0, 4, 0), lwc1(4, 4, 2), lwc1(8, 4, 4),
  ]);
  expect(allUnchecked).not.toContain('c.execLWC1(');
  expect(allUnchecked).toContain('Guarded RAM LWC1 group (3 loads)');

  // Writing Status via MTC0 or DMTC0 flushes any active group and forces the next COP1 access to recheck usability.
  for (const writeStatus of [
    copMove(decode.OP_COP0, decode.COP_MT, 5, regs.controlStatus),
    copMove(decode.OP_COP0, decode.COP_DMT, 5, regs.controlStatus),
  ]) {
    const { code } = await generate([
      copMove(decode.OP_COP1, decode.COP_MF, 2, 0),
      swc1(0, 4, 0), swc1(4, 4, 2),
      writeStatus,
      swc1(8, 4, 4), swc1(12, 4, 6), swc1(16, 4, 8),
    ]);
    expect(code).toContain('Guarded RAM SWC1 group (2 stores)');
    expect(code).toContain('c.execSWC1(4, 4, 8)');
    expect(code).toContain('Guarded RAM SWC1 group (2 stores)');
  }
});

for (const fullMode of [false, true]) {
  test(`guarded LWC1 and SWC1 preserve raw bits and odd/even mapping (FR=${Number(fullMode)})`, async () => {
    const { code } = await generate([
      lwc1(0, 4, 0),
      lwc1(0, 4, 2), lwc1(4, 4, 3),
      swc1(8, 4, 2), swc1(12, 4, 3),
    ]);
    expect(code).toContain('Guarded RAM LWC1 group (2 loads)');
    expect(code).toContain('Guarded RAM SWC1 group (2 stores)');
    expect(code).toContain('cpu1.regS32[4]');
    expect(code).toContain('cpu1.regS32[cpu1.regIdx32_cop[3]]');

    const ramDV = new DataView(new ArrayBuffer(0x1000));
    ramDV.setUint32(0x200, 0x7fa12345, false); // Signaling NaN payload
    ramDV.setUint32(0x204, 0xffffffff, false);
    const cpu1 = new CPU1();
    cpu1.fullMode = fullMode;
    const gprS32 = new Int32Array(64);
    gprS32[4 * 2] = 0x80000200 | 0;
    const c = {
      pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
      execLWC1: () => {},
      execLWC1Unchecked: () => { throw new Error('unexpected slow LWC1'); },
      execSWC1Unchecked: () => { throw new Error('unexpected slow SWC1'); },
    };
    new Function('c', 'cpu1', 'rsp', code)(c, cpu1, { halted: true, step() {} });
    expect(cpu1.regU32[4]).toBe(0x7fa12345);
    expect(cpu1.regU32[fullMode ? 6 : 5]).toBe(0xffffffff);
    expect(ramDV.getUint32(0x208, false)).toBe(0x7fa12345);
    expect(ramDV.getUint32(0x20c, false)).toBe(0xffffffff);
  });

  test(`guarded LDC1 and SDC1 enforce 8-byte alignment and odd/even mapping (FR=${Number(fullMode)})`, async () => {
    // 4-byte offset delta cannot form an 8-byte LDC1/SDC1 group.
    expect((await generate([
      lwc1(0, 4, 0),
      ldc1(0, 4, 2), ldc1(4, 4, 4),
    ])).code).not.toContain('Guarded RAM LDC1 group');

    const { code } = await generate([
      lwc1(0, 4, 0),
      ldc1(0, 4, 2), ldc1(8, 4, 3),
      sdc1(16, 4, 2), sdc1(24, 4, 3),
    ]);
    expect(code).toContain('Guarded RAM LDC1 group (2 loads)');
    expect(code).toContain('Guarded RAM SDC1 group (2 stores)');
    expect(code).toContain('(ramLoadBase & 0x80000007) === 0');
    expect(code).toContain('(ramStoreBase & 0x80000007) === 0');

    const ramDV = new DataView(new ArrayBuffer(0x1000));
    ramDV.setUint32(0x200, 0x7ff01234, false);
    ramDV.setUint32(0x204, 0x56789abc, false);
    ramDV.setUint32(0x208, 0xfff87654, false);
    ramDV.setUint32(0x20c, 0x3210fedc, false);
    const cpu1 = new CPU1();
    cpu1.fullMode = fullMode;
    const gprS32 = new Int32Array(64);
    gprS32[4 * 2] = 0x80000200 | 0;
    const fallbacks = [];
    const c = {
      pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
      execLWC1: () => {},
      execLDC1Unchecked: (...args) => fallbacks.push(['LDC1', ...args]),
      execSDC1Unchecked: (...args) => fallbacks.push(['SDC1', ...args]),
    };
    const fn = new Function('c', 'cpu1', 'rsp', code);
    fn(c, cpu1, { halted: true, step() {} });
    expect(fallbacks).toEqual([]);
    const oddBase = (fullMode ? 3 : 2) * 2;
    if (fullMode) {
      expect(cpu1.regU32[5]).toBe(0x7ff01234);
      expect(cpu1.regU32[4]).toBe(0x56789abc);
    }
    expect(cpu1.regU32[oddBase + 1]).toBe(0xfff87654);
    expect(cpu1.regU32[oddBase]).toBe(0x3210fedc);
    expect(ramDV.getUint32(0x218, false)).toBe(0xfff87654);
    expect(ramDV.getUint32(0x21c, false)).toBe(0x3210fedc);

    // A 4-byte-aligned base (0x80000204) fails the 8-byte alignment guard and runs the slow path.
    gprS32[4 * 2] = 0x80000204 | 0;
    fn(c, cpu1, { halted: true, step() {} });
    expect(fallbacks).toEqual([
      ['LDC1', 2, 4, 0],
      ['LDC1', 3, 4, 8],
      ['SDC1', 2, 4, 16],
      ['SDC1', 3, 4, 24],
    ]);
  });
}

test('group formation respects base writes, loads, delay slots, alignment and base changes', async () => {
  for (const words of [
    [0, sw(0)],
    [sw(0), sw(4)], // First instruction may have an incoming delay target when needsDelayCheck is true.
    [0, sw(0), sw(4, 5)],
    [0, sw(0), sw(2)], // No base can align both accesses.
    [0, sw(0), iop(decode.OP_ADDIU, 4, 4, 4), sw(4)],
    [0, sw(0), iop(decode.OP_LW, 4, 4), sw(4)],
    [0, sw(0), iop(decode.OP_LW, 4, 2), sw(4)],
    [iop(decode.OP_BEQ, 0, 0, 1), sw(0), sw(4)],
  ]) {
    expect((await generate(words)).code).not.toContain('Guarded RAM SW group');
  }
});

test('compileTraceSteps groups step 0 when entryDelayPC is null and guards step 0 when entryDelayPC is set', async () => {
  const { hardware } = await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });

  const nonDelayStoreFrag = new Fragment(pc, hardware.fragmentCache);
  nonDelayStoreFrag.recordInstruction(pc, sw(0), pc + 4, pc + 4);
  nonDelayStoreFrag.recordInstruction(pc + 4, sw(4), pc + 8, pc + 8);
  const nonDelaySwCode = compileTraceSteps(nonDelayStoreFrag);
  expect(nonDelaySwCode).toContain('Guarded RAM SW group (2 stores)');
  expect(nonDelaySwCode).not.toContain('c.delayPC ??');
  expect(nonDelaySwCode).not.toContain('if (c.delayPC !== null)');

  const nonDelayLoadFrag = new Fragment(pc, hardware.fragmentCache);
  nonDelayLoadFrag.recordInstruction(pc, lw(0, 4, 2), pc + 4, pc + 4);
  nonDelayLoadFrag.recordInstruction(pc + 4, lw(4, 4, 3), pc + 8, pc + 8);
  const nonDelayLwCode = compileTraceSteps(nonDelayLoadFrag);
  expect(nonDelayLwCode).toContain('Guarded RAM LW group (2 loads)');
  expect(nonDelayLwCode).not.toContain('c.delayPC ??');
  expect(nonDelayLwCode).not.toContain('if (c.delayPC !== null)');

  const delayEntryFrag = new Fragment(pc, hardware.fragmentCache);
  delayEntryFrag.entryDelayPC = pc + 0x20;
  delayEntryFrag.recordInstruction(pc, sw(0), pc + 0x20, pc + 4);
  delayEntryFrag.recordInstruction(pc + 0x20, sw(4), pc + 0x24, pc + 0x24);
  const delayEntryCode = compileTraceSteps(delayEntryFrag);
  expect(delayEntryCode).not.toContain('Guarded RAM SW group');
  expect(delayEntryCode).toContain('c.nextPC = c.delayPC ?? 0x80001004;');
  expect(delayEntryCode).toContain('if (c.pc !== 0x80001020) { return 1; }');
});

test('groups are bounded and discarded on fragment invalidation', async () => {
  const { code } = await generate([0, ...Array.from({ length: 18 }, (_, i) => sw(i * 4))]);
  expect(code).toContain('Guarded RAM SW group (16 stores)');
  expect(code).toContain('Guarded RAM SW group (2 stores)');
  const { ctx, fragment } = await generate([0, sw(0), sw(4)], { finish: false });
  expect(ctx.ramAccessGroup.count).toBe(2);
  fragment.invalidate();
  expect((await generate([0, sw(0)], { ctx, fragment })).code).not.toContain('Guarded RAM SW group');
});

test('scratch buffers survive flushes and new fragments without retaining old stores', async () => {
  const ctx = new FragmentContext();
  const group = ctx.ramAccessGroup;
  const buffers = [group.pcs, group.opsBefore, group.instructions, group.offsets, group.registers];
  // Fill all slots, then switch bases and use a shorter group with new bounds.
  await generate([0, ...Array.from({ length: 16 }, (_, i) => sw(-64 + i * 4))], { ctx });
  expect(group.count).toBe(0);
  const { code } = await generate([0, sw(12, 5, 3), sw(8, 5, 0)], { ctx });
  expect(code).toContain('Guarded RAM SW group (2 stores)');
  expect(code).toContain('(c.gprS32[10] + 8) ^ -0x80000000');
  expect(code).toContain('ramStoreDV.setUint32(ramStoreBase + 4, c.gprS32[6], false)');
  expect(code).toContain('ramStoreDV.setUint32(ramStoreBase + 0, 0, false)');
  expect(code).toContain('ramStoreBase + 8 <=');
  expect(code.match(/\/\/ SW\s+r0 -> \[a1\+0x0008\]/g)).toHaveLength(1);
  expect(code).not.toContain('c.execSW(2, 4,');
  expect(ctx.ramAccessGroup).toBe(group);
  for (const [i, buffer] of [group.pcs, group.opsBefore, group.instructions, group.offsets, group.registers].entries()) {
    expect(buffer).toBe(buffers[i]);
  }
  expect(group.count).toBe(0);
  // Repeated finalization and an abandoned singleton must not rewrite old code.
  finishCodeGeneration(ctx);
  expect(ctx.fragment.bodyCode).toBe(code);
  await generate([0, sw(-32768)], { ctx, finish: false });
  expect(group.count).toBe(1);
  expect((await generate([0, sw(0)], { ctx })).code).not.toContain('Guarded RAM SW group');
  expect(group.count).toBe(0);
});

test('guarded RAM store slow fallback refreshes rspHalted when an MMIO store wakes the RSP', async () => {
  const { code: swCode } = await generate([0, sw(0), sw(4)]);
  const { code: lwCode } = await generate([0, lw(0, 4, 2), lw(4, 4, 3)]);
  // Load groups never start the RSP even on the slow path; only slow-path stores refresh rspHalted per access.
  expect(lwCode).toContain('if (slowExit !== undefined) { return slowExit; }\n    rspHalted = rsp.halted;');
  expect(lwCode).not.toContain('c.execLW(2, 4, 0);\n  c.pc = c.nextPC;\n  c.delayPC = null;\n  if (c.stuffToDo) { return 2; }\n  rspHalted = rsp.halted;');
  expect(swCode).toContain('c.execSW(2, 4, 0);\n  c.pc = c.nextPC;\n  c.delayPC = null;\n  if (c.stuffToDo) { return 2; }\n  rspHalted = rsp.halted;');

  const ramDV = new DataView(new ArrayBuffer(0x1000));
  const gprS32 = new Int32Array(64);
  gprS32[4 * 2] = 0xa4040010 | 0; // SP_STATUS_REG (MMIO triggers slow fallback)
  let steps = 0;
  const rsp = {
    halted: true,
    step() { steps++; },
  };
  const c = {
    pc, delayPC: null, stuffToDo: 0, ramDV, gprS32,
    execSW: (_rt, _base, offset) => {
      if (offset === 0) {
        rsp.halted = false;
      }
    },
  };
  new Function('c', 'rsp', swCode)(c, rsp);
  // The first store wakes the RSP; the second store's preamble must step it.
  expect(steps).toBe(1);
});
