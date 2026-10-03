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
  test('publishes frozen graphics before raising the deferred DP interrupt', async () => {
    const { hardware } = await fixture();
    const events = [];
    hardware.graphics.setDPFrozen = frozen => events.push(frozen ? 'freeze' : 'publish');
    hardware.miRegDevice.interruptDP = () => events.push('interrupt');
    const dp = hardware.dpcDevice;
    dp.write32(base + status, 0x8);
    dp.syncFullHLE();
    dp.write32(base + status, 0x8);
    dp.write32(base + status, 0x200);
    expect(events).toEqual(['freeze']);
    dp.write32(base + status, 0x4);
    expect(events).toEqual(['freeze', 'publish', 'interrupt']);
    dp.write32(base + status, 0x4);
    expect(events).toHaveLength(3);
  });

  test('holds frozen HLE completions until unfreeze and signals them only once', async () => {
    const { hardware } = await fixture();
    const dp = hardware.dpcDevice;
    let interrupts = 0;
    hardware.miRegDevice.interruptDP = () => { interrupts++; };
    dp.statusReg = 0x28; // PIPE_BUSY | START_GCLK
    dp.write32(base + status, 0x8); // SET_FREEZE
    dp.syncFullHLE();
    dp.syncFullHLE();
    dp.write32(base + status, 0x200); // Clearing a counter must not release work.
    expect(interrupts).toBe(0);
    expect(dp.statusReg).toBe(0x2a);
    expect(dp.readU32(base + clock)).toBe(0);

    // The RSP and CPU register paths share the same pending completions.
    hardware.rsp.moveToControl(11, 0x4); // CLR_FREEZE
    expect(interrupts).toBe(1);
    expect(dp.statusReg).toBe(0);
    expect(dp.readU32(base + clock)).toBe(2);
    dp.write32(base + status, 0x4);
    expect(interrupts).toBe(1);
  });

  test('reset discards frozen HLE completions', async () => {
    const { hardware } = await fixture();
    const dp = hardware.dpcDevice;
    dp.write32(base + status, 0x8);
    dp.syncFullHLE();
    hardware.reset();
    dp.write32(base + status, 0x4);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(0);
    expect(dp.readU32(base + clock)).toBe(0);
    dp.syncFullHLE();
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_DP).toBe(MI_INTR_DP);
    expect(dp.readU32(base + clock)).toBe(1);
  });

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


describe('streamed RDP commands', () => {
  test('consumes appended packets exactly once and honours a new START', async () => {
    const { hardware } = await fixture();
    let interrupts = 0;
    hardware.miRegDevice.interruptDP = () => { interrupts++; };
    const dp = hardware.dpcDevice;
    for (const address of [0x100, 0x108, 0x200]) {
      hardware.ram.set32(address, 0xe9000000);
    }
    dp.write32(base, 0x100);
    dp.write32(base + 4, 0x108);
    expect([dp.currentReg, interrupts]).toEqual([0x108, 1]);
    dp.write32(base + 4, 0x110);
    dp.write32(base + 4, 0x110);
    expect([dp.currentReg, interrupts]).toEqual([0x110, 2]);
    dp.write32(base, 0x200);
    dp.write32(base, 0x100); // An already pending START cannot be overwritten.
    dp.write32(base + 4, 0x208);
    expect([dp.currentReg, interrupts]).toEqual([0x208, 3]);
  });

  test('waits for a whole raw texture rectangle and wraps XBUS fetches within DMEM', async () => {
    const { hardware } = await fixture();
    const packets = [];
    hardware.graphics.beginRDP = () => ({ execute: (type, buf) => {
      packets.push([type, buf.getU32(4), buf.getU32(8), buf.getU32(12)]);
    } });
    const dp = hardware.dpcDevice;
    dp.write32(base + status, 2); // XBUS
    hardware.sp_mem.set32(0xff8, 0xe4000000);
    hardware.sp_mem.set32(0xffc, 0x01000000);
    hardware.sp_mem.set32(0, 0x00200040);
    hardware.sp_mem.set32(4, 0x04000800);
    dp.write32(base, 0xff8);
    dp.write32(base + 4, 0x1000);
    expect(dp.currentReg).toBe(0xff8);
    expect(packets).toEqual([]);
    dp.write32(base + 4, 0x1008);
    expect(dp.currentReg).toBe(0x1008);
    expect(packets).toEqual([[0x24, 0x01000000, 0x00200040, 0x04000800]]);
  });

  test('keeps raw packets and FullSync pending until the DP is unfrozen', async () => {
    const { hardware } = await fixture();
    const events = [];
    hardware.graphics.beginRDP = () => ({ execute: type => events.push(type) });
    hardware.miRegDevice.interruptDP = () => events.push('sync');
    const dp = hardware.dpcDevice;
    hardware.ram.set32(0x100, 0xf7000000);
    hardware.ram.set32(0x108, 0xe9000000);
    dp.write32(base + status, 8);
    dp.write32(base, 0x100);
    dp.write32(base + 4, 0x110);
    expect([dp.currentReg, events]).toEqual([0x100, []]);
    dp.write32(base + status, 4);
    expect([dp.currentReg, events]).toEqual([0x110, [0x37, 'sync']]);
    dp.write32(base + status, 4);
    expect(events).toEqual([0x37, 'sync']);
  });
});
