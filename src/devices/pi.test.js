import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { MI_INTR_PI, MI_INTR_REG } from './mi.js';
import {
  PI_BSD_DOM1_LAT_REG, PI_BSD_DOM1_PWD_REG, PI_BSD_DOM1_PGS_REG, PI_BSD_DOM1_RLS_REG,
  PI_BSD_DOM2_LAT_REG, PI_BSD_DOM2_PWD_REG, PI_BSD_DOM2_PGS_REG, PI_BSD_DOM2_RLS_REG,
  PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_WR_LEN_REG, PI_STATUS_REG,
  PI_STATUS_DMA_BUSY, PI_STATUS_INTERRUPT, PI_STATUS_CLR_INTR, PI_STATUS_RESET,
} from './pi.js';

const piBase = 0xa4600000;

async function createEmulator(timings = 0x80371240) {
  const romBuffer = new ArrayBuffer(0x1000);
  new DataView(romBuffer).setUint32(0, timings);
  return createHeadlessEmulator({
    romBuffer,
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
}

function startDMA(hardware, cartAddress, length) {
  const pi = hardware.piRegDevice;
  pi.write32(piBase + PI_DRAM_ADDR_REG, 0x1000);
  pi.write32(piBase + PI_CART_ADDR_REG, cartAddress);
  pi.write32(piBase + PI_WR_LEN_REG, length - 1);
}

function advance(cpu, cycles) {
  cpu.incrementCount(cycles);
  cpu.eventQueue.incrementCount(cycles);
}

describe('PI cartridge timing', () => {
  test('browser initialization can simulate boot before a ROM is loaded', async () => {
    const { cpu0, hardware } = await createEmulator();
    const { simulateBoot } = await import('../boot.js');
    hardware.rom = null;
    hardware.pi_reg.clear();
    expect(() => simulateBoot(cpu0, hardware, hardware.rominfo)).not.toThrow();
    expect(hardware.pi_reg.getU32(PI_BSD_DOM1_LAT_REG)).toBe(0);
  });

  test('boot initializes domain 1 from the ROM header before the first DMA', async () => {
    for (const [header, expected] of [
      [0x80371240, [0x40, 0x12, 7, 3]],
      [0x80a53c12, [0x12, 0x3c, 5, 2]],
    ]) {
      const { hardware } = await createEmulator(header);
      expect([PI_BSD_DOM1_LAT_REG, PI_BSD_DOM1_PWD_REG, PI_BSD_DOM1_PGS_REG, PI_BSD_DOM1_RLS_REG]
        .map(reg => hardware.piRegDevice.readU32(piBase + reg))).toEqual(expected);
    }
  });

  test('timing registers retain only their implemented bits', async () => {
    const { hardware } = await createEmulator();
    for (const [reg, mask] of [
      [PI_BSD_DOM1_LAT_REG, 0xff], [PI_BSD_DOM1_PWD_REG, 0xff],
      [PI_BSD_DOM1_PGS_REG, 0xf], [PI_BSD_DOM1_RLS_REG, 3],
      [PI_BSD_DOM2_LAT_REG, 0xff], [PI_BSD_DOM2_PWD_REG, 0xff],
      [PI_BSD_DOM2_PGS_REG, 0xf], [PI_BSD_DOM2_RLS_REG, 3],
    ]) {
      hardware.piRegDevice.write32(piBase + reg, 0xffffffff);
      expect(hardware.piRegDevice.readU32(piBase + reg)).toBe(mask);
    }
  });

  for (const [offset, length, cycles] of [
    [0x100, 1, 161], // A byte still requires one cartridge halfword read.
    [0x100, 8, 264],
    [0x100, 128, 2334],
    [0x1fc, 8, 390], // Two cartridge pages need two address phases.
  ]) {
    test(`${length} bytes at ROM offset 0x${offset.toString(16)} complete after ${cycles} CPU cycles`, async () => {
      const { hardware, cpu0, fatalError } = await createEmulator();
      const data = Uint8Array.from({ length }, (_, i) => (i * 37 + 0x51) & 0xff);
      hardware.rom.u8.set(data, offset);
      hardware.ram.u8.fill(0xa5, 0x1000, 0x1000 + length + 8);
      startDMA(hardware, 0x10000000 + offset, length);

      expect(hardware.ram.u8.slice(0x1000, 0x1000 + length)).toEqual(data);
      expect(hardware.ram.u8[0x1000 + length]).toBe(0xa5);
      expect(cpu0.getCyclesUntilEvent('PI Interrupt')).toBe(cycles);
      expect(hardware.pi_reg.getU32(PI_STATUS_REG)).toBe(PI_STATUS_DMA_BUSY);
      advance(cpu0, cycles - 1);
      expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_PI).toBe(0);
      expect(hardware.piRegDevice.busy()).toBe(true);
      advance(cpu0, 1);
      expect(hardware.pi_reg.getU32(PI_STATUS_REG)).toBe(PI_STATUS_INTERRUPT);
      expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_PI).toBe(MI_INTR_PI);
      expect(cpu0.hasEvent('PI Interrupt')).toBe(false);
      expect(hardware.pi_reg.getU32(PI_DRAM_ADDR_REG)).toBe((0x1000 + length + 7) & ~7);
      expect(hardware.pi_reg.getU32(PI_CART_ADDR_REG)).toBe((0x10000000 + offset + length + 1) & ~1);
      hardware.piRegDevice.write32(piBase + PI_STATUS_REG, PI_STATUS_CLR_INTR);
      expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_PI).toBe(0);
      expect(fatalError()).toBeNull();
    });
  }

  test('guest timing changes affect the next DMA and survive a PI reset', async () => {
    const { hardware, cpu0 } = await createEmulator();
    hardware.piRegDevice.write32(piBase + PI_BSD_DOM1_PWD_REG, 35);
    hardware.piRegDevice.write32(piBase + PI_STATUS_REG, PI_STATUS_RESET);
    startDMA(hardware, 0x10000100, 8);
    expect(cpu0.getCyclesUntilEvent('PI Interrupt')).toBe(366);
  });

  test('a 1 MiB boot DMA stays busy for cartridge bus time, allowing CPU timers to advance', async () => {
    const { hardware, cpu0 } = await createEmulator();
    let timerFired = false;
    cpu0.addEvent('CPU timer during boot DMA', 10_000_000, () => { timerFired = true; });
    startDMA(hardware, 0x10001000, 1024 * 1024);
    expect(cpu0.getCyclesUntilEvent('PI Interrupt')).toBe(18_345_984);
    advance(cpu0, 10_000_000);
    expect(timerFired).toBe(true);
    expect(hardware.piRegDevice.busy()).toBe(true);
    advance(cpu0, 8_345_984);
    expect(hardware.piRegDevice.busy()).toBe(false);
  });
});
