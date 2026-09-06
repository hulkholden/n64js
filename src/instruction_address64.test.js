import { describe, expect, test } from 'bun:test';
import './headless_env.js';
import * as regs from './cpu0reg.js';
import { needsWideInstruction } from './decode.js';

const { Hardware } = await import('./hardware.js');
const { initCPU } = await import('./r4300.js');
const { initRSP } = await import('./rsp.js');
const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');
const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
const c = hardware.cpu0;
const base = 0xc00000abc0ea0000n;
const low = address => Number(address & 0xffffffffn);

function reset() {
  initCPU(hardware);
  initRSP(hardware);
  c.reset();
  hardware.rsp.halted = true;
  hardware.ram.clear();
  c.setControlU32(regs.controlStatus, 0x80); // Kernel 64-bit addressing.
  c.tlbEntries[0].update(0, 0, base, (2 << 6) | 7, (4 << 6) | 7);
  n64js.getSyncFlow = () => null;
  n64js.breakpoints = () => ({ isBreakpoint: () => false });
}

function start(address, delayPC = null) {
  c.wideState = { pc: address, delayPC };
  c.pc = low(address);
  c.delayPC = delayPC === null ? 0 : low(delayPC) || 1;
}

function write(offset, word) {
  hardware.ram.set32((offset < 4096 ? 0x2000 : 0x4000) + (offset & 4095), word);
}

function executeEntry(word, compiled, needsDelayCheck = true) {
  c.pc = 0x80001000;
  c.nextPC = c.pc + 4;
  if (compiled) {
    const fragment = new Fragment(c.pc);
    fragment.needsDelayCheck = needsDelayCheck;
    fragment.opsCompiled = 1;
    const ctx = new FragmentContext();
    ctx.set(fragment, c.pc, word, c.nextPC, c.nextPC);
    generateCodeForOp(ctx);
    // A wide jump must exit the fragment before another low-PC op executes.
    new Function('c', fragment.bodyCode + '\nc.setRegS32Extend(10, 123);')(c);
  } else {
    n64js.executeOp(word);
    c.pc = c.nextPC;
    c.delayPC = c.branchTarget;
  }
}

describe('64-bit instruction addresses', () => {
  test('outer dispatch consumes a handoff once and preserves state across events', () => {
    for (const compiled of [false, true]) {
      reset();
      c.setRegU64(3, base);
      hardware.ram.set32(0x1004, 0x24020001);
      write(0, 0x24420002);
      executeEntry((3 << 21) | 8, compiled);
      const count = c.getOpsExecuted();
      c.addRunForCyclesEvent(1);
      c.runImpl();
      expect(c.getRegU64(2)).toBe(1n);
      expect(c.wideState.pc).toBe(base);
      expect(c.getOpsExecuted() - count).toBe(1);
      c.addRunForCyclesEvent(1);
      c.runImpl();
      expect(c.getRegU64(2)).toBe(3n);
      expect(c.getOpsExecuted() - count).toBe(2);
    }
  });

  test('sequential execution retains a zero-extended PC when crossing bit 31', () => {
    reset();
    c.tlbEntries[0].update(0, 0, 0x7fffe000n, (2 << 6) | 7, (4 << 6) | 7);
    c.tlbEntries[1].update(1, 0, 0x80000000n, (6 << 6) | 7, (8 << 6) | 7);
    hardware.ram.set32(0x4ff8, 0x24020001);
    hardware.ram.set32(0x4ffc, 0x24420002);
    hardware.ram.set32(0x6000, 0x24420004);
    c.pc = 0x7ffffff8;
    const count = c.getOpsExecuted();
    c.addRunForCyclesEvent(3);
    c.runImpl();
    expect(c.getRegU64(2)).toBe(7n);
    expect(c.wideState.pc).toBe(0x80000004n);
    expect(c.getOpsExecuted() - count).toBe(3);
  });

  test('relative branches crossing below sign-extended bit 31 do not alias low memory', () => {
    reset();
    hardware.ram.set32(0, 0x1000fffe); // beq zero, zero, -2
    hardware.ram.set32(4, 0x24020001);
    c.pc = 0x80000000;
    c.addRunForCyclesEvent(3);
    expect(() => c.runImpl()).toThrow();
    expect(c.getRegU64(2)).toBe(1n);
    expect(c.getControlU64(regs.controlBadVAddr)).toBe(0xffffffff7ffffffcn);
    expect(c.getControlU64(regs.controlEPC)).toBe(0xffffffff7ffffffcn);
  });

  test('compiled boundary instructions hand off before executing or charging the instruction', () => {
    for (const [pc, word] of [[0x7ffffffc, 0], [0x7ffffff0, 0x10000004], [0x80000000, 0x1000fffe], [0xfffffffc, 0]]) {
      reset();
      expect(needsWideInstruction(pc, word)).toBe(true);
      c.pc = pc;
      const fragment = new Fragment(pc);
      fragment.opsCompiled = 1;
      const ctx = new FragmentContext();
      ctx.set(fragment, pc, word, pc + 4, pc + 4);
      generateCodeForOp(ctx);
      const count = c.getOpsExecuted();
      expect(new Function('c', fragment.bodyCode)(c)).toBe(0);
      expect(c.pc).toBe(pc);
      expect(c.getOpsExecuted()).toBe(count);
      expect(c.stuffToDo & 4).toBe(4);
    }
    expect(needsWideInstruction(0x80001000, 0x1000ffff)).toBe(false);
  });

  for (const compiled of [false, true]) {
    for (const link of [false, true]) {
      test(`${compiled ? 'compiled' : 'interpreted'} ${link ? 'JALR' : 'JR'} enters wide code after its delay slot`, () => {
        reset();
        c.setRegU64(3, base);
        hardware.ram.set32(0x1004, 0x24020001); // addiu v0, zero, 1
        write(0, 0x24420002); // addiu v0, v0, 2
        executeEntry((3 << 21) | (link ? (4 << 11) | 9 : 8), compiled);
        expect(c.wideState.pc).toBe(0xffffffff80001004n);
        expect(c.wideState.delayPC).toBe(base);
        expect(c.getRegU64(10)).toBe(0n);
        if (link) expect(c.getRegU64(4)).toBe(0xffffffff80001008n);
        expect(c.stuffToDo & 4).toBe(4);
        c.stuffToDo &= ~4; // Outer dispatcher consumes the handoff flag.
        c.stepWide();
        expect(c.wideState.pc).toBe(base);
        expect(c.getRegU64(2)).toBe(1n);
        c.stepWide();
        expect(c.getRegU64(2)).toBe(3n);
      });
    }
  }

  test('ordinary sign-extended register jumps stay on the fast path', () => {
    reset();
    c.setRegU64(3, 0xffffffff80002000n);
    expect(c.prepareWideJump(3, 0x80001004)).toBe(0x80002000);
    expect(c.wideState).toBeNull();
  });

  test('optimized compiled register jumps initialize the wide delay-slot PC', () => {
    for (const word of [(3 << 21) | 8, (3 << 21) | (4 << 11) | 9]) {
      reset();
      c.setRegU64(3, base);
      executeEntry(word, true, false);
      expect(c.pc).toBe(0x80001004);
      expect(c.wideState.pc).toBe(0xffffffff80001004n);
      expect(c.wideState.delayPC).toBe(base);
      expect(c.getRegU64(10)).toBe(0n);
    }
  });

  test('linear fetch crosses split PFNs and returns to ordinary code', () => {
    reset();
    [0x24020000, 0x24420001, 0x24420002, 0x24420004, 0x24420008, 0x00800008, 0].forEach((word, i) => write(4088 + i * 4, word));
    c.setRegU64(4, 0xffffffff80002000n);
    start(base + 4088n);
    for (let i = 0; i < 7; i++) c.stepWide();
    expect(c.getRegU64(2)).toBe(15n);
    expect(c.pc).toBe(0x80002000);
    expect(c.wideState).toBeNull();
  });

  test('branch delay and likely-annul preserve the upper PC across a page', () => {
    reset();
    write(4092, 0x10000001); // beq zero, zero, +1
    write(4096, 0x24020001);
    write(4100, 0x24420002);
    start(base + 4092n);
    for (let i = 0; i < 3; i++) c.stepWide();
    expect(c.getRegU64(2)).toBe(3n);
    expect(c.wideState.pc).toBe(base + 4104n);
    write(4092, 0x54000001); // bnel zero, zero, +1 (annul)
    c.setRegU64(2, 0n);
    start(base + 4092n);
    c.stepWide();
    expect(c.wideState.pc).toBe(base + 4100n);
    c.stepWide();
    expect(c.getRegU64(2)).toBe(2n);
  });

  test('wide JALR preserves a full-width link when rd aliases rs', () => {
    reset();
    write(0, (3 << 21) | (3 << 11) | 9);
    c.setRegU64(3, base + 0x100n);
    start(base);
    c.stepWide();
    expect(c.wideState.delayPC).toBe(base + 0x100n);
    expect(c.getRegU64(3)).toBe(base + 8n);
  });

  test('wide branches to address zero still execute their delay slot', () => {
    reset();
    write(0, 0x00600008); // jr v1, initially zero
    write(4, 0x24020007);
    start(base);
    c.stepWide();
    expect(c.wideState.delayPC).toBe(0n);
    c.stepWide();
    expect(c.getRegU64(2)).toBe(7n);
    expect(c.pc).toBe(0);
    expect(c.wideState).toBeNull();
  });

  test('JAL retains region and upper VPN bits and writes a full-width link', () => {
    reset();
    write(0, 0x0c000000 | ((low(base + 0x100n) >>> 2) & 0x03ffffff));
    start(base);
    c.stepWide();
    expect(c.wideState.delayPC).toBe(base + 0x100n);
    expect(c.getRegU64(31)).toBe(base + 8n);
  });

  test('TLB lookup compares high VPN and region bits', () => {
    reset();
    write(0, 0x24020007);
    expect(c.fetchWideInstruction(base)).toBe(0x24020007);
    for (const address of [base ^ (1n << 32n), base ^ (2n << 62n)]) {
      reset();
      start(address);
      expect(() => c.stepWide()).toThrow();
      expect(c.getControlU32(regs.controlCause) & 0x7c).toBe(8);
      expect(c.getControlU64(regs.controlBadVAddr)).toBe(address);
      expect(c.getControlU64(regs.controlEPC)).toBe(address);
      expect(c.getControlU64(regs.controlEntryHi) & 0xc00000ffffffe000n).toBe(address & 0xc00000ffffffe000n);
      expect(c.nextPC).toBe(0x80000080);
    }
  });

  test('wide delay-slot exceptions retain full EPC and BD', () => {
    reset();
    write(4, 0x0000000c); // syscall
    start(base + 4n, base + 0x100n);
    c.stepWide();
    expect(c.getControlU64(regs.controlEPC)).toBe(base);
    expect(c.getControlU32(regs.controlCause)).toBe(0x80000020);
    expect(c.pc).toBe(0x80000180);
    expect(c.wideState).toBeNull();
  });

  test('invalid odd-page delay-slot fetch uses the general vector and full EPC', () => {
    reset();
    c.tlbEntries[0].update(0, 0, base, (2 << 6) | 7, (4 << 6) | 5);
    start(base + 4096n, base + 0x100n);
    expect(() => c.stepWide()).toThrow();
    expect(c.getControlU64(regs.controlEPC)).toBe(base + 4092n);
    expect(c.getControlU64(regs.controlBadVAddr)).toBe(base + 4096n);
    expect(c.getControlU32(regs.controlCause)).toBe(0x80000008);
    expect(c.nextPC).toBe(0x80000180);
  });

  test('wide TLB lookup honors ASIDs and global mappings', () => {
    reset();
    c.tlbEntries[0].update(0, 0, base | 7n, (2 << 6) | 6, (4 << 6) | 6);
    expect(c.tlbFindEntry64(base)).toBeNull();
    c.setControlU64(regs.controlEntryHi, 7n);
    expect(c.tlbFindEntry64(base)).toBe(c.tlbEntries[0]);
    c.setControlU64(regs.controlEntryHi, 9n);
    c.tlbEntries[0].update(0, 0, base | 7n, (2 << 6) | 7, (4 << 6) | 7);
    expect(c.tlbFindEntry64(base)).toBe(c.tlbEntries[0]);
  });

  test('compiled ERET exits the fragment before entering wide code', () => {
    reset();
    c.setControlU32(regs.controlStatus, 0x82);
    c.setControlU64(regs.controlEPC, base);
    executeEntry(0x42000018, true);
    expect(c.wideState.pc).toBe(base);
    expect(c.pc).toBe(low(base));
    expect(c.getRegU64(10)).toBe(0n);
  });

  test('misaligned wide fetch raises AdEL without truncating BadVAddr', () => {
    reset();
    start(base + 2n);
    expect(() => c.stepWide()).toThrow();
    expect(c.getControlU32(regs.controlCause) & 0x7c).toBe(16);
    expect(c.getControlU64(regs.controlBadVAddr)).toBe(base + 2n);
    c.handleEmulatedException();
    expect(c.pc).toBe(0x80000180);
    expect(c.wideState).toBeNull();
  });

  test('XKPHYS instruction fetch bypasses the TLB', () => {
    reset();
    hardware.ram.set32(0x2000, 0x24020007);
    for (const address of [0x9000000000002000n, 0x9800000000002000n]) {
      expect(c.fetchWideInstruction(address)).toBe(0x24020007);
    }
  });

  test('wide fetch validates mode, segment holes and XKPHYS reserved bits', () => {
    for (const [address, status] of [[base, 0], [base, 0x30], [base, 0x48],
      [0xc00000ff80000000n, 0x80], [0x0000010000000000n, 0x80], [0x9000000100000000n, 0x80]]) {
      reset();
      c.setControlU32(regs.controlStatus, status);
      start(address);
      expect(() => c.stepWide()).toThrow();
      expect(c.getControlU32(regs.controlCause) & 0x7c).toBe(16);
      expect(c.getControlU64(regs.controlBadVAddr)).toBe(address);
    }
  });

  test('ERET restores wide EPC and ErrorEPC', () => {
    for (const error of [false, true]) {
      reset();
      c.setControlU32(regs.controlStatus, 0x80 | (error ? 4 : 2));
      c.setControlU64(error ? regs.controlErrorEPC : regs.controlEPC, base);
      c.execERET();
      expect(c.wideState.pc).toBe(base);
      expect(c.wideState.delayPC).toBeNull();
      expect(c.nextPC).toBe(low(base));
      expect(c.getControlU32(regs.controlStatus)).toBe(0x80);
    }
  });
});
