import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_WR_LEN_REG, PI_STATUS_REG, PI_STATUS_CLR_INTR } from '../devices/pi.js';
import { SP_IMEM_OFFSET } from '../devices/sp_constants.js';
import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { classifyAudioTask, hleProcessAudioTask } from './hle_audio.js';
import { TASK_OFFSET, TASK_SIZE, TaskOffsets } from './rsp_task_constants.js';

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

async function fixture() {
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
    audioMicrocodeManifest.programs = [{ id: 'abi1-standard-mixer', family: 'ABI1',
      codeBytes: 4, codeSha256: hash(h.ram.u8.subarray(CODE, CODE + 4)),
      dataBytes: CONSTANT_BYTES, dataSha256: hash(h.ram.u8.subarray(CONSTANTS, CONSTANTS + CONSTANT_BYTES)) }];
    expect(classifyAudioTask(h).identity).toBe('abi1-standard-mixer');
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
