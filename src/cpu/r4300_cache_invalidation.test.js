import { describe, expect, test } from 'bun:test';
import { Fragment } from './fragments.js';
import { FragmentContext, finishCodeGeneration } from './recompiler.js';
import {
  DEFAULT_PC,
  JR_RA,
  cacheOp,
  compileOp,
  compileOps,
  createTestEmulator,
  trainLoopAt,
  trainTraceAt,
} from './test_helpers.js';

async function fixture() {
  const emulator = await createTestEmulator();
  emulator.cpu0.reset();
  return emulator;
}

function cache(emulator, compiled, op, address) {
  const { cpu0: cpu, hardware } = emulator;
  cpu.pc = DEFAULT_PC;
  cpu.setRegS32Extend(4, address);
  const word = cacheOp(op, 4); // CACHE op,0(a0)
  if (compiled) {
    new Function('c', compileOp(word).bodyCode)(cpu);
  } else {
    hardware.ram.set32(0x1000, word);
    cpu.run(1);
  }
}

test('guarded RAM stores retain compiled code until the guest invalidates the I-cache', async () => {
  const emulator = await fixture();
  const targetPC = 0x8011a860;
  const target = trainLoopAt(emulator, targetPC);
  const c = emulator.cpu0;
  c.setRegS32Extend(4, targetPC);
  c.setRegS32Extend(2, JR_RA); // JR ra
  c.setRegS32Extend(3, 0x25080002); // ADDIU t0,t0,2
  const fragment = new Fragment(DEFAULT_PC);
  const ctx = new FragmentContext();
  compileOps([0, 0xac820000, 0xac830004], { pc: DEFAULT_PC, ctx, fragment }); // NOP; SW v0,0(a0); SW v1,4(a0)
  finishCodeGeneration(ctx);
  expect(fragment.bodyCode).toContain('Guarded RAM SW group');
  c.pc = fragment.entryPC;
  new Function('c', fragment.bodyCode)(c);
  expect(emulator.hardware.ram.getU32((targetPC & 0x7fffff) + 4)).toBe(0x25080002);
  expect(target.func).toBeFunction();
  cache(emulator, true, 0x10, targetPC);
  expect(target.func).toBeUndefined();
});

for (const compiled of [false, true]) {
  describe(`${compiled ? 'compiled' : 'interpreted'} CACHE invalidation`, () => {
    test('overlay return address executes new instructions without the stale delay-slot store', async () => {
      const emulator = await fixture();
      const { cpu0: cpu, hardware } = emulator;
      const pc = 0x8011a860;
      hardware.ram.set32(0x11a860, JR_RA);
      hardware.ram.set32(0x11a864, 0xafa40000); // SW a0,0(sp)
      cpu.setRegS32Extend(29, 0x80003000);
      cpu.setRegS32Extend(4, 0x12345678);
      trainTraceAt(emulator, pc);
      expect(hardware.ram.getU32(0x3000)).toBe(0x12345678);

      hardware.ram.set32(0x11a860, 0x305907f0); // ANDI t9,v0,0x7f0
      hardware.ram.set32(0x11a864, 0x57200011); // BNEL t9,zero,0x8011a8ac
      hardware.ram.set32(0x11a868, 0xafa40000); // Observable new branch delay slot
      hardware.ram.set32(0x3000, 0xfeedface);
      cpu.setRegS32Extend(2, 0); // Not taken: annul the likely branch's store.
      cache(emulator, compiled, 0, 0x80002860);
      expect(hardware.fragmentCache.fragments.get(pc).func).toBeUndefined();
      cpu.pc = pc;
      const count = cpu.controlCountValue;
      cpu.run(2);
      expect(cpu.pc).toBe(0x8011a86c);
      expect(cpu.delayPC).toBeNull();
      expect(cpu.controlCountValue - count).toBe(2);
      expect(hardware.ram.getU32(0x3000)).toBe(0xfeedface);
    });

    test('index invalidate discards overlay tags and cached next-fragment references', async () => {
      const emulator = await fixture();
      const pc = 0x8011a860;
      const old = trainLoopAt(emulator, pc);
      const otherTag = trainLoopAt(emulator, pc + 0x4000);
      const otherIndex = trainLoopAt(emulator, pc + 0x20);
      const caller = new Fragment(0x80002000, emulator.hardware.fragmentCache);
      caller.nextFragments[2] = old;
      emulator.hardware.ram.set32((pc & 0x7fffff) + 4, 0x25080002); // replacement overlay

      // Same VA[13:5], different tag, and a nonzero byte offset.
      cache(emulator, compiled, 0, 0x8000287f);
      expect(old.func).toBeUndefined();
      expect(otherTag.func).toBeUndefined();
      expect(otherIndex.func).toBeFunction();
      expect(caller.getNextFragment(pc, 2).func).toBeUndefined();

      const before = emulator.cpu0.getRegU32Lo(8);
      emulator.cpu0.setRegS32Extend(31, pc);
      emulator.cpu0.pc = pc;
      emulator.cpu0.run(20);
      expect(emulator.cpu0.getRegU32Lo(8) - before).toBe(20);
      expect(emulator.cpu0.pc).toBe(pc);
      expect(emulator.cpu0.delayPC).toBeNull();
      expect(emulator.fatalError()).toBeNull();
    });

    test('hit invalidate still requires the addressed line, and D-cache ops do not discard code', async () => {
      const emulator = await fixture();
      const pc = 0x8011a860;
      const fragment = trainLoopAt(emulator, pc);
      cache(emulator, compiled, 0x10, 0x80002860);
      expect(fragment.func).toBeFunction();
      cache(emulator, compiled, 1, pc);
      expect(fragment.func).toBeFunction();
      cache(emulator, compiled, 0x10, pc + 4);
      expect(fragment.func).toBeUndefined();
    });
  });
}
