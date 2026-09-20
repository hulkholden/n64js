import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import { MI_INTR_REG, MI_INTR_SI } from './mi.js';
import {
  SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG,
  SI_STATUS_REG, SI_STATUS_DMA_BUSY, SI_STATUS_DMA_ERROR, SI_STATUS_INTERRUPT,
} from './si.js';

const base = 0xa4800000;
const pifAddress = 0x1fc007c0;

async function fixture() {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { hardware, cpu0 } = emulator;
  const si = hardware.siRegDevice;
  si.write32(base + SI_DRAM_ADDR_REG, 0x1000);
  return {
    hardware, si,
    advance(cycles) {
      cpu0.incrementCount(cycles);
      cpu0.eventQueue.incrementCount(cycles);
    },
    status: () => si.readU32(base + SI_STATUS_REG),
    interrupt: () => hardware.mi_reg.getBits32(MI_INTR_REG, MI_INTR_SI),
  };
}

describe('SI DMA completion', () => {
  test('both directions remain busy until completion, then raise an acknowledgeable interrupt', async () => {
    const { si, advance, status, interrupt } = await fixture();
    for (const reg of [SI_PIF_ADDR_WR64B_REG, SI_PIF_ADDR_RD64B_REG]) {
      si.write32(base + reg, pifAddress);
      expect(status()).toBe(SI_STATUS_DMA_BUSY);
      expect(interrupt()).toBe(0);
      advance(0x8ff);
      expect(status()).toBe(SI_STATUS_DMA_BUSY);
      expect(interrupt()).toBe(0);
      advance(1);
      expect(status()).toBe(SI_STATUS_INTERRUPT);
      expect(interrupt()).toBe(MI_INTR_SI);
      si.write32(base + SI_STATUS_REG, 0);
      expect(status()).toBe(0);
      expect(interrupt()).toBe(0);
    }
  });

  test('acknowledging an interrupt during another DMA does not finish or cancel it', async () => {
    const { si, advance, status, interrupt } = await fixture();
    si.write32(base + SI_PIF_ADDR_WR64B_REG, pifAddress);
    advance(0x900);
    si.write32(base + SI_PIF_ADDR_RD64B_REG, pifAddress);
    expect(status()).toBe(SI_STATUS_DMA_BUSY | SI_STATUS_INTERRUPT);
    si.write32(base + SI_STATUS_REG, 0);
    expect(status()).toBe(SI_STATUS_DMA_BUSY);
    expect(interrupt()).toBe(0);
    advance(0x900);
    expect(status()).toBe(SI_STATUS_INTERRUPT);
    expect(interrupt()).toBe(MI_INTR_SI);
  });

  test('rejects overlapping transfers without copying data or replacing the pending completion', async () => {
    const { hardware, si, advance, status, interrupt } = await fixture();
    hardware.ram.u8[0x1000] = 0xfe; // End of Joybus commands.
    si.write32(base + SI_PIF_ADDR_WR64B_REG, pifAddress);
    hardware.ram.u8.fill(0xcc, 0x2000, 0x2040);
    advance(0x400);
    si.write32(base + SI_DRAM_ADDR_REG, 0x2000);
    si.write32(base + SI_PIF_ADDR_RD64B_REG, pifAddress);
    expect(status()).toBe(SI_STATUS_DMA_BUSY | SI_STATUS_DMA_ERROR);
    expect([...hardware.ram.u8.slice(0x2000, 0x2040)]).toEqual(Array(64).fill(0xcc));
    advance(0x500);
    expect(status()).toBe(SI_STATUS_DMA_ERROR | SI_STATUS_INTERRUPT);
    expect(interrupt()).toBe(MI_INTR_SI);
    si.write32(base + SI_STATUS_REG, 0);
    advance(0x900);
    expect(interrupt()).toBe(0);
  });

  test('reset discards an in-flight completion and allows a fresh transfer', async () => {
    const { hardware, si, advance, status, interrupt } = await fixture();
    si.write32(base + SI_PIF_ADDR_WR64B_REG, pifAddress);
    advance(0x400);
    hardware.reset();
    advance(0x900);
    expect(status()).toBe(0);
    expect(interrupt()).toBe(0);
    si.write32(base + SI_PIF_ADDR_WR64B_REG, pifAddress);
    advance(0x900);
    expect(status()).toBe(SI_STATUS_INTERRUPT);
    expect(interrupt()).toBe(MI_INTR_SI);
  });
});
