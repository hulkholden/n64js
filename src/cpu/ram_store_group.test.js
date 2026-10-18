import { expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Fragment } from './fragments.js';
import { FragmentContext, emitTraceStep, finishCodeGeneration } from './recompiler.js';
import * as decode from './decode.js';

const pc = 0x80001000;
const iop = (op, s, t, immediate = 0) => ((op << 26) | (s << 21) | (t << 16) | (immediate & 0xffff)) >>> 0;
const sw = (offset, base = 4, rt = 2) => iop(decode.OP_SW, base, rt, offset);

async function generate(words, { finish = true, fragment = new Fragment(pc), ctx = new FragmentContext() } = {}) {
  await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
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

for (const [name, base, offsets, bytes, hits] of [
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
]) {
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
}

test('group formation respects base writes, loads, delay slots, alignment and base changes', async () => {
  for (const words of [
    [0, sw(0)],
    [sw(0), sw(4)], // First instruction may have an incoming delay target.
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

test('groups are bounded and discarded on fragment invalidation', async () => {
  const { code } = await generate([0, ...Array.from({ length: 18 }, (_, i) => sw(i * 4))]);
  expect(code).toContain('Guarded RAM SW group (16 stores)');
  expect(code).toContain('Guarded RAM SW group (2 stores)');
  const { ctx, fragment } = await generate([0, sw(0), sw(4)], { finish: false });
  expect(ctx.ramStoreGroup.count).toBe(2);
  fragment.invalidate();
  expect((await generate([0, sw(0)], { ctx, fragment })).code).not.toContain('Guarded RAM SW group');
});

test('scratch buffers survive flushes and new fragments without retaining old stores', async () => {
  const ctx = new FragmentContext();
  const group = ctx.ramStoreGroup;
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
  expect(code).not.toContain('c.execSW(2, 4,');
  expect(ctx.ramStoreGroup).toBe(group);
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
