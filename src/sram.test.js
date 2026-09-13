import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless_env.js';
import { PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_RD_LEN_REG, PI_WR_LEN_REG } from './devices/pi.js';
import { OS_TV_NTSC } from './system_constants.js';

function createEmulator() {
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save: 'SRAM' },
  });
}

describe('SRAM word accesses', () => {
  test('reads the first and last words without modifying save state', async () => {
    const { hardware } = await createEmulator();
    hardware.saveMem.set32(0, 0x89abcdef);
    hardware.saveMem.set32(0x7ffc, 0x12345678);
    expect(hardware.romD2A2Device.readU32(0xa8000000)).toBe(0x89abcdef);
    expect(hardware.romD2A2Device.readU32(0xa8007ffc)).toBe(0x12345678);
    expect(hardware.saveDirty).toBe(false);
  });

  test('writes update persistent save memory and are visible to PI DMA', async () => {
    const { hardware } = await createEmulator();
    hardware.romD2A2Device.write32(0xa8000000, 0x89abcdef);
    hardware.romD2A2Device.write32(0xa8007ffc, 0x12345678);
    expect(hardware.saveMem.getU32(0)).toBe(0x89abcdef);
    expect(hardware.saveMem.getU32(0x7ffc)).toBe(0x12345678);
    expect(hardware.saveDirty).toBe(true);

    hardware.pi_reg.set32(PI_DRAM_ADDR_REG, 0x1000);
    hardware.pi_reg.set32(PI_CART_ADDR_REG, 0x08000000);
    hardware.pi_reg.set32(PI_WR_LEN_REG, 7);
    hardware.piRegDevice.copyToRDRAM();
    expect(hardware.ram.getU32(0x1000)).toBe(0x89abcdef);
  });

  test('PI DMA writes are visible through CPU word reads', async () => {
    const { hardware } = await createEmulator();
    hardware.ram.set32(0x1000, 0x12345678);
    hardware.ram.set32(0x1004, 0x89abcdef);
    hardware.pi_reg.set32(PI_DRAM_ADDR_REG, 0x1000);
    hardware.pi_reg.set32(PI_CART_ADDR_REG, 0x08000010);
    hardware.pi_reg.set32(PI_RD_LEN_REG, 7);
    hardware.piRegDevice.copyFromRDRAM();
    expect(hardware.romD2A2Device.readU32(0xa8000010)).toBe(0x12345678);
    expect(hardware.romD2A2Device.readU32(0xa8000014)).toBe(0x89abcdef);
    expect(hardware.saveDirty).toBe(true);
  });
});
