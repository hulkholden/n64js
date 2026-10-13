import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';
import {
  SP_DMA_BUSY_REG, SP_DRAM_ADDR_REG, SP_MEM_ADDR_REG, SP_RD_LEN_REG, SP_STATUS_DMA_BUSY, SP_STATUS_REG,
} from './sp_constants.js';

const base = 0xa4040000;

async function fixture() {
  const emulator = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
  });
  const { hardware, cpu0 } = emulator;
  const sp = hardware.spRegDevice;
  return {
    hardware, sp,
    advance(cycles) {
      cpu0.incrementCount(cycles);
      cpu0.eventQueue.incrementCount(cycles);
    },
  };
}

describe('SPRegDevice DMA state', () => {
  test('initializes pending DMA address latches and clears queued DMAs on reset', async () => {
    const { hardware, sp, advance } = await fixture();
    expect(sp.pendingSPMemAddr).toBe(0);
    expect(sp.pendingDRAMAddr).toBe(0);

    hardware.ram.set32(0x100, 0x12345678);
    hardware.ram.set32(0x200, 0xdeadbeef);

    sp.write32(base + SP_MEM_ADDR_REG, 0x10);
    sp.write32(base + SP_DRAM_ADDR_REG, 0x100);
    sp.write32(base + SP_RD_LEN_REG, 0x17); // 24 bytes -> 3 cycles

    // Queue a second DMA while the first is in flight.
    sp.write32(base + SP_MEM_ADDR_REG, 0x40);
    sp.write32(base + SP_DRAM_ADDR_REG, 0x200);
    sp.write32(base + SP_RD_LEN_REG, 0x17);
    expect(sp.dmaQueue.length).toBe(2);

    hardware.reset();
    expect(sp.pendingSPMemAddr).toBe(0);
    expect(sp.pendingDRAMAddr).toBe(0);
    expect(sp.dmaQueue.length).toBe(0);

    // Advancing past the original completion time must not run the queued second DMA.
    hardware.sp_mem.set32(0x40, 0);
    advance(32);
    expect(hardware.sp_mem.getU32(0x40)).toBe(0);
    expect(sp.readU32(base + SP_DMA_BUSY_REG)).toBe(0);
    expect(sp.readU32(base + SP_STATUS_REG) & SP_STATUS_DMA_BUSY).toBe(0);
  });
});
