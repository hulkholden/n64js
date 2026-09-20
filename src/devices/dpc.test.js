import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { MI_INTR_DP, MI_INTR_REG } from './mi.js';

const base = 0xa4100000;
const status = 0x0c;
const clock = 0x10;
const counters = [clock, 0x14, 0x18, 0x1c];

async function fixture() {
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
}

describe('DPC HLE clock approximation', () => {
  test('credits completed work before the DP interrupt and exposes it to CPU and RSP reads', async () => {
    const { hardware } = await fixture();
    const dp = hardware.dpcDevice;
    expect(dp.readU32(base + clock)).toBe(0);
    dp.statusReg = 0x28; // PIPE_BUSY | START_GCLK
    let observed;
    const interrupt = hardware.miRegDevice.interruptDP;
    hardware.miRegDevice.interruptDP = function () {
      observed = [dp.readU32(base + clock), dp.statusReg];
      return interrupt.call(this);
    };
    dp.syncFullHLE();
    expect(observed).toEqual([1, 0]);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
    expect(hardware.rsp.moveFromControl(12)).toBe(1);
    dp.syncFullHLE();
    expect(dp.readU32(base + clock)).toBe(2);
    // Reading counters is passive, and HLE does not invent busy-counter data.
    expect(counters.map(reg => dp.readU32(base + reg))).toEqual([2, 0, 0, 0]);
    hardware.reset();
    expect(dp.readU32(base + clock)).toBe(0);
  });

  test('wraps at 24 bits and resumes counting after a guest clear', async () => {
    const { hardware } = await fixture();
    const dp = hardware.dpcDevice;
    hardware.dpc_mem.set32(clock, 0xffffff);
    dp.syncFullHLE();
    expect(dp.readU32(base + clock)).toBe(0);
    dp.syncFullHLE();
    expect(dp.readU32(base + clock)).toBe(1);
    hardware.rsp.moveToControl(11, 0x200);
    expect(dp.readU32(base + clock)).toBe(0);
    dp.syncFullHLE();
    expect(dp.readU32(base + clock)).toBe(1);
  });

  test('keeps counters read-only and clears only those selected by status writes', async () => {
    const { hardware } = await fixture();
    const dp = hardware.dpcDevice;
    for (const [reg, clearBit] of [[clock, 0x200], [0x14, 0x100], [0x18, 0x80], [0x1c, 0x40]]) {
      counters.forEach((offset, i) => hardware.dpc_mem.set32(offset, i + 1));
      dp.write32(base + reg, 99);
      expect(dp.readU32(base + reg)).toBe(counters.indexOf(reg) + 1);
      dp.statusReg = 0x407;
      dp.write32(base + status, clearBit);
      expect(counters.map(offset => dp.readU32(base + offset))).toEqual(counters.map((offset, i) => offset === reg ? 0 : i + 1));
      expect(dp.statusReg).toBe(0x407);
    }
    dp.write32(base + status, 0x3c0 | 0x4); // Clear all counters and FREEZE.
    expect(counters.map(reg => dp.readU32(base + reg))).toEqual([0, 0, 0, 0]);
    expect(dp.statusReg).toBe(0x405);
  });
});
