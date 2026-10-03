import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { getFragmentMap, Fragment } from './fragments.js';
import { FragmentContext, generateCodeForOp, finishCodeGeneration } from './recompiler.js';
import { recompilerOptions } from '../options.js';

async function fixture() {
  const e = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  e.cpu0.reset();
  return e;
}

function train(e, pc) {
  const { cpu0: c, hardware } = e;
  hardware.ram.set32(pc & 0x7fffff, 0x03e00008); // JR ra
  hardware.ram.set32((pc & 0x7fffff) + 4, 0x25080001); // ADDIU t0,t0,1
  c.setRegS32Extend(31, pc);
  c.pc = pc;
  c.run(12000);
  const fragment = getFragmentMap().get(pc);
  expect(fragment?.executionCount).toBeGreaterThan(0);
  return fragment;
}

function cache(e, compiled, op, address) {
  const c = e.cpu0;
  c.pc = 0x80001000;
  c.setRegS32Extend(4, address);
  const word = (0xbc800000 | (op << 16)) >>> 0; // CACHE op,0(a0)
  if (compiled) {
    const fragment = new Fragment(c.pc);
    fragment.opsCompiled = 1;
    const context = new FragmentContext();
    context.set(fragment, c.pc, word, c.pc + 4, c.pc + 4);
    generateCodeForOp(context);
    new Function('c', fragment.bodyCode)(c);
  } else {
    e.hardware.ram.set32(0x1000, word);
    c.run(1);
  }
}

test('guarded RAM stores retain compiled code until the guest invalidates the I-cache', async () => {
  const previous = recompilerOptions.guardedRAMStores;
  recompilerOptions.guardedRAMStores = true;
  try {
    const e = await fixture();
    const targetPC = 0x8011a860;
    const target = train(e, targetPC);
    const c = e.cpu0;
    c.setRegS32Extend(4, targetPC);
    c.setRegS32Extend(2, 0x03e00008); // JR ra
    c.setRegS32Extend(3, 0x25080002); // ADDIU t0,t0,2
    const fragment = new Fragment(0x80001000);
    const context = new FragmentContext();
    for (const word of [0, 0xac820000, 0xac830004]) { // NOP; SW v0,0(a0); SW v1,4(a0)
      const pc = fragment.entryPC + fragment.opsCompiled++ * 4;
      context.set(fragment, pc, word, pc + 4, pc + 4);
      generateCodeForOp(context);
    }
    finishCodeGeneration(context);
    expect(fragment.bodyCode).toContain('Guarded RAM SW group');
    c.pc = fragment.entryPC;
    new Function('c', fragment.bodyCode)(c);
    expect(e.hardware.ram.getU32((targetPC & 0x7fffff) + 4)).toBe(0x25080002);
    expect(target.func).toBeFunction();
    cache(e, true, 0x10, targetPC);
    expect(target.func).toBeUndefined();
  } finally {
    recompilerOptions.guardedRAMStores = previous;
  }
});

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} CACHE invalidation`, () => {
    test('overlay return address executes new instructions without the stale delay-slot store', async () => {
      const e = await fixture();
      const { cpu0: c, hardware: h } = e;
      const pc = 0x8011a860;
      h.ram.set32(0x11a860, 0x03e00008); // JR ra
      h.ram.set32(0x11a864, 0xafa40000); // SW a0,0(sp)
      c.setRegS32Extend(31, pc);
      c.setRegS32Extend(29, 0x80003000);
      c.setRegS32Extend(4, 0x12345678);
      c.pc = pc;
      c.run(12000);
      expect(getFragmentMap().get(pc)?.executionCount).toBeGreaterThan(0);
      expect(h.ram.getU32(0x3000)).toBe(0x12345678);

      h.ram.set32(0x11a860, 0x305907f0); // ANDI t9,v0,0x7f0
      h.ram.set32(0x11a864, 0x57200011); // BNEL t9,zero,0x8011a8ac
      h.ram.set32(0x11a868, 0xafa40000); // Observable new branch delay slot
      h.ram.set32(0x3000, 0xfeedface);
      c.setRegS32Extend(2, 0); // Not taken: annul the likely branch's store.
      cache(e, compiled, 0, 0x80002860);
      expect(getFragmentMap().get(pc).func).toBeUndefined();
      c.pc = pc;
      const count = c.controlCountValue;
      c.run(2);
      expect(c.pc).toBe(0x8011a86c);
      expect(c.delayPC).toBeNull();
      expect(c.controlCountValue - count).toBe(2);
      expect(h.ram.getU32(0x3000)).toBe(0xfeedface);
    });

    test('index invalidate discards overlay tags and cached next-fragment references', async () => {
      const e = await fixture();
      const pc = 0x8011a860;
      const old = train(e, pc);
      const otherTag = train(e, pc + 0x4000);
      const otherIndex = train(e, pc + 0x20);
      const caller = new Fragment(0x80002000);
      caller.nextFragments[2] = old;
      e.hardware.ram.set32((pc & 0x7fffff) + 4, 0x25080002); // replacement overlay

      // Same VA[13:5], different tag, and a nonzero byte offset.
      cache(e, compiled, 0, 0x8000287f);
      expect(old.func).toBeUndefined();
      expect(otherTag.func).toBeUndefined();
      expect(otherIndex.func).toBeFunction();
      expect(caller.getNextFragment(pc, 2).func).toBeUndefined();

      const before = e.cpu0.getRegU32Lo(8);
      e.cpu0.setRegS32Extend(31, pc);
      e.cpu0.pc = pc;
      e.cpu0.run(20);
      expect(e.cpu0.getRegU32Lo(8) - before).toBe(20);
      expect(e.cpu0.pc).toBe(pc);
      expect(e.cpu0.delayPC).toBeNull();
      expect(e.fatalError()).toBeNull();
    });

    test('hit invalidate still requires the addressed line, and D-cache ops do not discard code', async () => {
      const e = await fixture();
      const pc = 0x8011a860;
      const fragment = train(e, pc);
      cache(e, compiled, 0x10, 0x80002860);
      expect(fragment.func).toBeFunction();
      cache(e, compiled, 1, pc);
      expect(fragment.func).toBeFunction();
      cache(e, compiled, 0x10, pc + 4);
      expect(fragment.func).toBeUndefined();
    });
  });
}
