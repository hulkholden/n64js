import { expect } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { Hardware } from '../hardware.js';
import * as regs from './cpu0reg.js';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import { initCPU } from './r4300.js';
import { FragmentContext, finishCodeGeneration, generateCodeForOp } from './recompiler.js';

export const DEFAULT_PC = 0x80001000;
export const JR_RA = 0x03e00008;
export const ADDIU_T0_1 = 0x25080001;

export const iop = (op, rs, rt, immediate = 0) =>
  ((op << 26) | (rs << 21) | (rt << 16) | (immediate & 0xffff)) >>> 0;

export const special = (op, rs, rt, rd, shift = 0) =>
  ((decode.OP_SPECIAL << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (shift << 6) | op) >>> 0;

export const regimm = (rt, rs, immediate = 0) =>
  iop(0x01, rs, rt, immediate);

export const copMove = (op, transfer, rt, rd) =>
  ((op << 26) | (transfer << 21) | (rt << 16) | (rd << 11)) >>> 0;

export const cop1 = (format, func, fd, fs, ft = 0) =>
  ((decode.OP_COP1 << 26) | (format << 21) | (ft << 16) | (fs << 11) | (fd << 6) | func) >>> 0;

export const jump = (target, op = decode.OP_J) =>
  ((op << 26) | ((target >>> 2) & 0x03ffffff)) >>> 0;

export const cacheOp = (op, base, offset = 0) =>
  iop(0x2f, base, op, offset);

export async function createTestEmulator() {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  return emulator;
}

export async function createTestCPU() {
  const { cpu0 } = await createTestEmulator();
  return cpu0;
}

export function createTestHardware() {
  const hardware = new Hardware({ save: 'Eeprom4k' }, { headless: true });
  initCPU(hardware);
  return hardware;
}

export function resetTestHardware(hardware) {
  initCPU(hardware);
  hardware.cpu0.reset();
  hardware.cpu0.setControlU32(regs.controlStatus, 0);
  hardware.ram.clear();
}

export function compileOp(word, { pc = DEFAULT_PC, postPC = pc + 4, nextPC = postPC, needsDelayCheck, cop1statusKnown } = {}) {
  const fragment = new Fragment(pc);
  fragment.opsCompiled = 1;
  if (needsDelayCheck !== undefined) {
    fragment.needsDelayCheck = needsDelayCheck;
  }
  if (cop1statusKnown !== undefined) {
    fragment.cop1statusKnown = cop1statusKnown;
  }
  const ctx = new FragmentContext();
  ctx.set(fragment, pc, word >>> 0, postPC, nextPC);
  generateCodeForOp(ctx);
  finishCodeGeneration(ctx);
  return fragment;
}

export function compileOps(words, { pc = DEFAULT_PC, ctx = new FragmentContext(), fragment = new Fragment(pc), target } = {}) {
  words.forEach((word, index) => {
    fragment.opsCompiled++;
    const addr = pc + index * 4;
    const postPC = target !== undefined && index === words.length - 1 ? target : addr + 4;
    ctx.set(fragment, addr, word >>> 0, postPC, postPC);
    generateCodeForOp(ctx);
  });
  finishCodeGeneration(ctx);
  return fragment;
}

export function createOpRunner(compiled, word, options = {}) {
  const instruction = word >>> 0;
  if (!compiled) {
    return () => globalThis.n64js.executeOp(instruction);
  }
  const fragment = compileOp(instruction, options);
  const run = new Function('c', fragment.bodyCode);
  run.code = fragment.bodyCode;
  return run;
}

export function warmFragmentLookup(hardware, pc = DEFAULT_PC, count = 499) {
  for (let i = 0; i < count; i++) {
    hardware.fragmentCache.lookupFragment(pc);
  }
}

export function compileFragmentAt(cpu, pc = DEFAULT_PC, cycles = 12) {
  warmFragmentLookup(cpu.hardware, pc);
  cpu.run(cycles);
  const fragment = cpu.hardware.fragmentCache.fragments.get(pc);
  expect(fragment?.func).toBeFunction();
  return fragment;
}

export function trainTraceAt(emulator, pc = DEFAULT_PC, cycles = 12000) {
  emulator.cpu0.pc = pc;
  emulator.cpu0.setRegS32Extend(31, pc);
  emulator.cpu0.run(cycles);
  const fragment = emulator.hardware.fragmentCache.fragments.get(pc);
  expect(fragment?.func).toBeFunction();
  expect(emulator.fatalError()).toBeNull();
  return fragment;
}

export function trainLoopAt(emulator, pc = DEFAULT_PC, physical = pc & 0x7fffff) {
  emulator.hardware.ram.set32(physical, JR_RA);
  emulator.hardware.ram.set32(physical + 4, ADDIU_T0_1);
  return trainTraceAt(emulator, pc);
}

export function advanceCycles(cpu, cycles) {
  cpu.incrementCount(cycles);
  cpu.eventQueue.incrementCount(cycles);
}

export function writeTLBEntry(cpu, index, entryHi, lo0 = 0x87, lo1 = 0xc7, pageMask = 0) {
  cpu.setControlU32(regs.controlIndex, index);
  cpu.setControlU32(regs.controlPageMask, pageMask);
  cpu.setControlU64(regs.controlEntryHi, BigInt(entryHi | 0));
  cpu.setControlU32(regs.controlEntryLo0, lo0);
  cpu.setControlU32(regs.controlEntryLo1, lo1);
  cpu.tlbWriteIndex();
}

export function resetGPRsWithSentinel(cpu, sentinel = 0x13579bdf2468ace0n) {
  cpu.gprU64.fill(sentinel);
  cpu.gprU64[0] = 0n;
}

export function createLCG64(seed = 0x123456789abcdefn) {
  let state = seed;
  return () => {
    state = BigInt.asUintN(64, state * 6364136223846793005n + 1442695040888963407n);
    return state;
  };
}

export function bitSweepValues64(baseValues = [], randomCount = 0, seed = 0x123456789abcdefn) {
  const values = [...baseValues];
  for (let bit = 0n; bit < 64n; bit++) {
    values.push(1n << bit, BigInt.asUintN(64, ~(1n << bit)));
  }
  const next = createLCG64(seed);
  for (let i = 0; i < randomCount; i++) {
    values.push(next());
  }
  return values;
}

export function cartesianPairs(values) {
  return values.flatMap(s => values.map(t => [s, t]));
}

export function resetExecutionState(cpu, words, { pc = DEFAULT_PC } = {}) {
  const { hardware } = cpu;
  cpu.reset();
  cpu.controlCountValue = 0;
  cpu.opsExecuted = 0;
  cpu.llBit = 0;
  cpu.lastControlRegWrite = 0n;
  cpu.setControlU32(regs.controlStatus, 0x20000000);
  cpu.cop1ControlChanged();
  hardware.cpu1.reset();
  hardware.rsp.reset();
  hardware.sp_mem.clear();
  hardware.sp_reg.clear();
  hardware.mi_reg.clear();
  hardware.ram.u8.fill(0);
  words.forEach((word, i) => hardware.ram.set32((pc & 0x7fffff) + i * 4, word));
  cpu.pc = pc;
}

export function captureExecutionSnapshot(emulator, { ramOffset = 0x3000, ramLength = 0x20 } = {}) {
  expect(emulator.fatalError()).toBeNull();
  const { cpu0: cpu, hardware } = emulator;
  return {
    pc: cpu.pc,
    delayPC: cpu.delayPC,
    llBit: cpu.llBit,
    llAddr: cpu.getControlU32(regs.controlLLAddr),
    gpr: [...cpu.gprU64],
    control: [...cpu.controlRegU64],
    hi: cpu.getMultHiU64(),
    lo: cpu.getMultLoU64(),
    cause: cpu.getControlU32(regs.controlCause),
    epc: cpu.getControlU32(regs.controlEPC),
    badVAddr: cpu.getControlU32(regs.controlBadVAddr),
    status: cpu.getControlU32(regs.controlStatus),
    fcsr: hardware.cpu1.control[31],
    fpr: Array.from({ length: 32 }, (_, i) => hardware.cpu1.loadU32(hardware.cpu1.fdRegIdx32(i))),
    rawFpr: [...hardware.cpu1.regU32],
    memory: [...hardware.ram.u8.slice(ramOffset, ramOffset + ramLength)],
    count: cpu.controlCountValue,
    countCycles: cpu.controlCountValue,
    ops: cpu.getOpsExecuted(),
    compareCycles: cpu.getCyclesUntilEvent('Compare'),
    mi: [...hardware.mi_reg.u8],
    sp: [...hardware.sp_reg.u8],
    rspPC: hardware.rsp.pc,
    rspGPR: [...hardware.rsp.gprU32],
    rspHalted: hardware.rsp.halted,
    rspMemory: [...hardware.sp_mem.u8.slice(0, 64)],
    rsp: {
      pc: hardware.rsp.pc,
      delayPC: hardware.rsp.delayPC,
      halted: hardware.rsp.halted,
      gpr: [...hardware.rsp.gprU32],
      memory: [...hardware.rsp.dmem.u8],
    },
  };
}
