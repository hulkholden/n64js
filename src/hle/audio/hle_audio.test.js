import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createHeadlessEmulator } from '../../headless/headless_env.js';
import { PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_WR_LEN_REG, PI_STATUS_REG, PI_STATUS_CLR_INTR } from '../../devices/pi.js';
import { SP_IMEM_OFFSET, SP_STATUS_REG, SP_STATUS_TASKDONE, SP_STATUS_BROKE, SP_STATUS_HALT,
  SP_CLR_HALT, SP_SET_HALT, SP_CLR_INTR, SP_CLR_BROKE, SP_CLR_SIG2, SP_SET_INTR_BREAK, SP_SET_SSTEP, SP_SEMAPHORE_REG } from '../../devices/sp_constants.js';
import {
  ABI1_STANDARD_MIXER, ABI1_DIDDY_BLAST_MIXER, ABI1_GOLDENEYE_MIXER, audioMicrocodeManifest,
} from './microcode_manifest.js';
import { EmulationMode } from '../emulation_mode.js';
import { classifyAudioTask, dispatchAudioTask, hleProcessAudioTask } from './hle_audio.js';
import { MI_INTR_REG, MI_INTR_SP } from '../../devices/mi.js';
import { TASK_OFFSET, TASK_SIZE, TaskOffsets } from '../rsp_task_constants.js';

const PI_BASE = 0xa4600000;
const ROM_BASE = 0x10000000;
const ROM_SAMPLE = 0x100;
const ROM_BYTES = 0x1000;
const ROM_HEADER = 0x80371240;
const AUDIO_TASK = 2;
const CODE = 0x1000;
const CONSTANTS = 0x2000;
const CONSTANT_BYTES = 0x2c0;
const COMMANDS = 0x3000;
const INPUT = 0x5000;
const OUTPUT = 0x6000;
const SAMPLE_BYTES = 16;
const COMMAND_BYTES = 8;
const OP_SET_BUFFER = 0x08000000;
const OP_LOAD_BUFFER = 0x04000000;
const OP_SAVE_BUFFER = 0x06000000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(identity = ABI1_STANDARD_MIXER) {
  const romBuffer = new ArrayBuffer(ROM_BYTES);
  new DataView(romBuffer).setUint32(0, ROM_HEADER);
  new Uint8Array(romBuffer).fill(0x37, ROM_SAMPLE, ROM_SAMPLE + SAMPLE_BYTES);
  const emulator = await createHeadlessEmulator({ romBuffer, rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
  const h = emulator.hardware;
  h.sp_mem.clear();
  h.rsp.pc = 0;
  const task = new DataView(h.sp_mem.u8.buffer, TASK_OFFSET, TASK_SIZE);
  task.setUint32(TaskOffsets.type, AUDIO_TASK);
  task.setUint32(TaskOffsets.ucodePtr, CODE);
  task.setUint32(TaskOffsets.ucodeDataPtr, CONSTANTS);
  task.setUint32(TaskOffsets.ucodeDataSize, CONSTANT_BYTES);
  task.setUint32(TaskOffsets.dataPtr, COMMANDS);
  task.setUint32(TaskOffsets.dataSize, 3 * COMMAND_BYTES);
  for (const [i, word] of [OP_SET_BUFFER, SAMPLE_BYTES, OP_LOAD_BUFFER, INPUT, OP_SAVE_BUFFER, OUTPUT].entries()) {
    h.ram.set32(COMMANDS + i * 4, word);
  }

  // Register a synthetic identity only while constructing this hardware's
  // classifier. No ROM code is embedded, and other classifiers keep the real
  // manifest. The command list exercises the actual ABI1 load/store handlers.
  const { bootstraps, programs } = audioMicrocodeManifest;
  try {
    audioMicrocodeManifest.bootstraps = [{ id: 'test-bootstrap', bytes: 4, sha256: hash(h.sp_mem.u8.subarray(SP_IMEM_OFFSET, SP_IMEM_OFFSET + 4)) }];
    audioMicrocodeManifest.programs = [{ id: identity, family: 'ABI1',
      codeBytes: 4, codeSha256: hash(h.ram.u8.subarray(CODE, CODE + 4)),
      dataBytes: CONSTANT_BYTES, dataSha256: hash(h.ram.u8.subarray(CONSTANTS, CONSTANTS + CONSTANT_BYTES)) }];
    expect(classifyAudioTask(h).identity).toBe(identity);
  } finally {
    audioMicrocodeManifest.bootstraps = bootstraps;
    audioMicrocodeManifest.programs = programs;
  }

  // Observe the reset generation, then establish the normal HLE path.
  expect(hleProcessAudioTask(h)).toBe(false);
  expect(hleProcessAudioTask(h)).toBe(true);
  h.ram.u8.fill(0xa5, OUTPUT, OUTPUT + SAMPLE_BYTES);
  return emulator;
}

function startDMA(h) {
  const pi = h.piRegDevice;
  pi.write32(PI_BASE + PI_DRAM_ADDR_REG, INPUT);
  pi.write32(PI_BASE + PI_CART_ADDR_REG, ROM_BASE + ROM_SAMPLE);
  pi.write32(PI_BASE + PI_WR_LEN_REG, SAMPLE_BYTES - 1);
}

function finishDMA({ hardware, cpu0 }) {
  const cycles = cpu0.getCyclesUntilEvent('PI Interrupt');
  cpu0.incrementCount(cycles);
  cpu0.eventQueue.incrementCount(cycles);
  hardware.piRegDevice.write32(PI_BASE + PI_STATUS_REG, PI_STATUS_CLR_INTR);
  expect(hardware.piRegDevice.busy()).toBe(false);
}

function expectUntouchedFallback(h) {
  const ram = h.ram.u8.slice(), sp = h.sp_mem.u8.slice();
  expect(hleProcessAudioTask(h)).toBe(false);
  expect(h.ram.u8).toEqual(ram);
  expect(h.sp_mem.u8).toEqual(sp);
  expect(h.rsp.pc).toBe(0);
}

describe('audio HLE during PI sample streaming', () => {
  test('active DMA falls back without modifying the task or memory', async () => {
    const { hardware: h } = await fixture();
    startDMA(h);
    expectUntouchedFallback(h);
    // A transfer can span consecutive audio tasks without another submission.
    expectUntouchedFallback(h);
  });

  test('idle gaps between transfers fall back, then HLE resumes after a quiet interval', async () => {
    const emulator = await fixture(), h = emulator.hardware;
    for (let i = 0; i < 2; i++) {
      startDMA(h);
      finishDMA(emulator);
      expectUntouchedFallback(h);
    }
    expect(hleProcessAudioTask(h)).toBe(true);
    expect(h.ram.u8.slice(OUTPUT, OUTPUT + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0x37));
  });

  test('reset invalidates previously observed PI activity', async () => {
    const { hardware: h } = await fixture();
    h.piRegDevice.reset();
    expectUntouchedFallback(h);
    expect(hleProcessAudioTask(h)).toBe(true);
  });
});


const HLE_EVENT = 'HLE task wait';
const COMPLETE = SP_STATUS_TASKDONE | SP_STATUS_BROKE | SP_STATUS_HALT;
function startTask(h) {
  h.sp_reg.set32(SP_SEMAPHORE_REG, 1);
  h.spRegDevice.spUpdateStatus(SP_CLR_HALT | SP_CLR_BROKE | SP_CLR_SIG2 | SP_SET_INTR_BREAK);
}
function advance(cpu, cycles) {
  while (cycles > 0) {
    const step = cpu.eventQueue.firstEvent ? Math.min(cycles, cpu.eventQueue.nextEventCountdown()) : cycles;
    cpu.incrementCount(step);
    cpu.eventQueue.incrementCount(step);
    cycles -= step;
  }
}
function poll(cpu) {
  expect(cpu.hasEvent(HLE_EVENT)).toBe(true);
  advance(cpu, cpu.getCyclesUntilEvent(HLE_EVENT));
}
function expectPending(h) {
  expect(h.spRegDevice.hleTask).toBeInstanceOf(Function);
  expect(h.rsp.halted).toBe(true);
  expect(h.ram.u8.slice(OUTPUT, OUTPUT + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0xa5));
  expect(h.sp_reg.getU32(SP_STATUS_REG) & COMPLETE).toBe(0);
  expect(h.sp_reg.getU32(SP_SEMAPHORE_REG)).toBe(1);
  expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(0);
}

describe('deferred GoldenEye audio', () => {
  test('waits for active PI DMA and a quiet poll before publishing output and exactly one SP interrupt', async () => {
    const { hardware: h, cpu0 } = await fixture(ABI1_GOLDENEYE_MIXER);
    // Keep PI busy over several continuation polls.
    h.piRegDevice.write32(PI_BASE + 0x18, 255);
    startDMA(h);
    startTask(h);
    const initialSP = h.sp_mem.u8.slice();
    let interrupts = 0;
    const interrupt = h.miRegDevice.interruptSP;
    h.miRegDevice.interruptSP = function () { interrupts++; return interrupt.call(this); };
    poll(cpu0);
    expect(h.piRegDevice.busy()).toBe(true);
    expectPending(h);
    expect(h.sp_mem.u8).toEqual(initialSP);
    while (h.piRegDevice.busy()) {
      poll(cpu0);
    }
    expectPending(h); // First idle observation does not execute the task.
    poll(cpu0);
    expect(h.ram.u8.slice(OUTPUT, OUTPUT + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0x37));
    expect(h.sp_reg.getU32(SP_STATUS_REG) & COMPLETE).toBe(COMPLETE);
    expect(h.sp_reg.getU32(SP_SEMAPHORE_REG)).toBe(0);
    expect(h.spRegDevice.hleTask).toBeNull();
    expect(cpu0.hasEvent(HLE_EVENT)).toBe(false);
    expect(interrupts).toBe(1);
    advance(cpu0, 3000);
    expect(interrupts).toBe(1);
  });

  test('an idle gap followed by a complete transfer between polls restarts the quiet interval', async () => {
    const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
    startDMA(h);
    finishDMA(e);
    startTask(h); // PI is idle at task submission, but the stream is not over.
    advance(cpu0, 100);
    h.rom.u8.fill(0x49, ROM_SAMPLE, ROM_SAMPLE + SAMPLE_BYTES);
    startDMA(h);
    finishDMA(e); // The whole second transfer fits between HLE polls.
    poll(cpu0);
    expectPending(h);
    poll(cpu0);
    expect(h.ram.u8.slice(OUTPUT, OUTPUT + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0x49));
    // A subsequent task without PI activity keeps the synchronous HLE path.
    expect(dispatchAudioTask(h, EmulationMode.HLE)).toBe(true);
  });

  test('reads the command list at continuation time, after the producer has updated it', async () => {
    const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
    startDMA(h);
    finishDMA(e);
    startTask(h);
    h.ram.set32(COMMANDS + 20, OUTPUT + 0x100);
    poll(cpu0);
    expect(h.ram.u8.slice(OUTPUT, OUTPUT + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0xa5));
    expect(h.ram.u8.slice(OUTPUT + 0x100, OUTPUT + 0x100 + SAMPLE_BYTES)).toEqual(new Uint8Array(SAMPLE_BYTES).fill(0x37));
  });

  test('halt pauses without committing, then resumes the pending task', async () => {
    const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
    startDMA(h);
    startTask(h);
    const continuation = h.spRegDevice.hleTask;
    h.spRegDevice.spUpdateStatus(SP_SET_HALT);
    expect(cpu0.hasEvent(HLE_EVENT)).toBe(false);
    advance(cpu0, 5000);
    expect(h.ram.u8[OUTPUT]).toBe(0xa5);
    h.spRegDevice.spUpdateStatus(SP_CLR_HALT | SP_CLR_INTR);
    expect(h.spRegDevice.hleTask).toBe(continuation);
    poll(cpu0);
    expectPending(h);
    poll(cpu0);
    expect(h.ram.u8[OUTPUT]).toBe(0x37);
  });

  test('reset cancels the callback without publishing stale audio', async () => {
    const { hardware: h, cpu0 } = await fixture(ABI1_GOLDENEYE_MIXER);
    startDMA(h);
    startTask(h);
    h.reset();
    expect(h.spRegDevice.hleTask).toBeNull();
    expect(cpu0.hasEvent(HLE_EVENT)).toBe(false);
    advance(cpu0, 5000);
    expect(h.ram.u8[OUTPUT]).toBe(0);
    expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(0);
  });

  test('unsupported commands roll back earlier stores before handing the task to LLE', async () => {
    const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
    h.sp_mem.set32(TASK_OFFSET + TaskOffsets.dataSize, 4 * COMMAND_BYTES);
    h.ram.set32(COMMANDS + 24, 0xff000000);
    startDMA(h);
    finishDMA(e);
    const initialSP = h.sp_mem.u8.slice(), initialRAM = h.ram.u8.slice();
    startTask(h);
    poll(cpu0);
    expect(h.ram.u8).toEqual(initialRAM);
    expect(h.sp_mem.u8).toEqual(initialSP);
    expect(h.spRegDevice.hleTask).toBeNull();
    expect(cpu0.hasEvent(HLE_EVENT)).toBe(false);
    expect(h.rsp.pc).toBe(0);
    expect(h.rsp.halted).toBe(false);
    expect(h.sp_reg.getU32(SP_STATUS_REG) & COMPLETE).toBe(0);
    expect(h.sp_reg.getU32(SP_SEMAPHORE_REG)).toBe(1);
    expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(0);
    // Only the real RSP BREAK subsequently raises completion.
    h.sp_mem.set32(SP_IMEM_OFFSET, 13);
    h.rsp.step();
    expect(h.sp_reg.getU32(SP_STATUS_REG) & SP_STATUS_BROKE).toBe(SP_STATUS_BROKE);
    expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(MI_INTR_SP);
  });

  for (const [name, mutate] of [
    ['task', h => h.sp_mem.set32(TASK_OFFSET + TaskOffsets.dataPtr, COMMANDS + 8)],
    ['code', h => h.ram.u8[CODE] ^= 1],
    ['constants', h => h.ram.u8[CONSTANTS] ^= 1],
    ['entry PC', h => h.rsp.pc = 4],
    ['delay PC', h => h.rsp.delayPC = 4],
    ['single step', h => h.spRegDevice.spUpdateStatus(SP_SET_SSTEP)],
  ]) {
    test(`changed ${name} rejects a pending task without completing it`, async () => {
      const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
      startDMA(h);
      finishDMA(e);
      startTask(h);
      mutate(h);
      poll(cpu0);
      expect(h.ram.u8[OUTPUT]).toBe(0xa5);
      expect(h.rsp.halted).toBe(false);
      expect(h.spRegDevice.hleTask).toBeNull();
      expect(h.sp_reg.getU32(SP_STATUS_REG) & COMPLETE).toBe(0);
      expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(0);
    });
  }

  test('SP DMA started while waiting hands the untouched task to LLE', async () => {
    const e = await fixture(ABI1_GOLDENEYE_MIXER), { hardware: h, cpu0 } = e;
    startDMA(h);
    finishDMA(e);
    startTask(h);
    advance(cpu0, cpu0.getCyclesUntilEvent(HLE_EVENT) - 1);
    h.spRegDevice.writeReg32(0, 0x800);
    h.spRegDevice.writeReg32(4, 0x7000);
    h.spRegDevice.writeReg32(8, 127);
    poll(cpu0);
    expect(h.spRegDevice.dmaQueue).toHaveLength(1);
    expect(h.spRegDevice.hleTask).toBeNull();
    expect(h.rsp.halted).toBe(false);
    expect(h.ram.u8[OUTPUT]).toBe(0xa5);
    expect(h.mi_reg.getU32(MI_INTR_REG) & MI_INTR_SP).toBe(0);
  });

  test('other microcodes, explicit LLE, and single stepping retain the existing fallback', async () => {
    for (const [identity, mode, singleStep] of [
      [ABI1_STANDARD_MIXER, EmulationMode.HLE, false],
      [ABI1_DIDDY_BLAST_MIXER, EmulationMode.HLE, false],
      [ABI1_GOLDENEYE_MIXER, EmulationMode.LLE, false],
      [ABI1_GOLDENEYE_MIXER, EmulationMode.HLE, true],
    ]) {
      const { hardware: h } = await fixture(identity);
      startDMA(h);
      if (singleStep) {
        h.spRegDevice.spUpdateStatus(SP_SET_SSTEP);
      }
      expect(dispatchAudioTask(h, mode)).toBe(false);
    }
  });
});
