import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from './headless/headless_env.js';
import { PI_CART_ADDR_REG, PI_DRAM_ADDR_REG, PI_RD_LEN_REG, PI_WR_LEN_REG } from './devices/pi.js';
import { OS_TV_NTSC } from './system_constants.js';

function createEmulator(save = 'SRAM') {
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, save },
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

describe('96 KiB SRAM banks', () => {
  test('does not alias unmapped gaps, a fourth bank, or transfers crossing a bank boundary', async () => {
    for (const cartAddress of [0x08008000, 0x080c0000, 0x08047ffc]) {
      for (const direction of ['read', 'write']) {
        const { hardware, fatalError } = await createEmulator('SRAM96k');
        hardware.saveMem.u8.fill(0x3c);
        hardware.ram.u8.fill(0xa5, 0x1000, 0x1008);
        const originalSave = hardware.saveMem.u8.slice();
        hardware.pi_reg.set32(PI_DRAM_ADDR_REG, 0x1000);
        hardware.pi_reg.set32(PI_CART_ADDR_REG, cartAddress);
        if (direction === 'read') {
          hardware.pi_reg.set32(PI_WR_LEN_REG, 7);
          hardware.piRegDevice.copyToRDRAM();
        } else {
          hardware.pi_reg.set32(PI_RD_LEN_REG, 7);
          hardware.piRegDevice.copyFromRDRAM();
        }
        expect(fatalError()).toContain('outside SRAM bank');
        expect(hardware.saveMem.u8).toEqual(originalSave);
        expect([...hardware.ram.u8.slice(0x1000, 0x1008)]).toEqual(Array(8).fill(0xa5));
        expect(hardware.saveDirty).toBe(false);
      }
    }
  });

  test('allocates three independent banks shared by CPU and DMA accesses', async () => {
    const { hardware, cpu0, fatalError } = await createEmulator('SRAM96k');
    expect(hardware.saveMem?.length).toBe(96 * 1024);
    for (let bank = 0; bank < 3; bank++) {
      hardware.ram.set32(0x1000, 0x12345670 + bank);
      hardware.ram.set32(0x1004, 0x89abcde0 + bank);
      hardware.pi_reg.set32(PI_DRAM_ADDR_REG, 0x1000);
      hardware.pi_reg.set32(PI_CART_ADDR_REG, 0x08000000 + bank * 0x40000);
      hardware.pi_reg.set32(PI_RD_LEN_REG, 7);
      hardware.piRegDevice.copyFromRDRAM();
      cpu0.removeEvent('PI Interrupt');
      hardware.piRegDevice.dmaComplete();
    }
    for (let bank = 0; bank < 3; bank++) {
      const cartAddress = 0x08000000 + bank * 0x40000;
      expect(hardware.saveMem.getU32(bank * 0x8000)).toBe(0x12345670 + bank);
      expect(hardware.romD2A2Device.readU32(0xa0000000 + cartAddress)).toBe(0x12345670 + bank);
      hardware.romD2A2Device.write32(0xa0000000 + cartAddress + 4, 0xfedcba90 + bank);
      hardware.pi_reg.set32(PI_DRAM_ADDR_REG, 0x2000 + bank * 8);
      hardware.pi_reg.set32(PI_CART_ADDR_REG, cartAddress);
      hardware.pi_reg.set32(PI_WR_LEN_REG, 7);
      hardware.piRegDevice.copyToRDRAM();
      cpu0.removeEvent('PI Interrupt');
      hardware.piRegDevice.dmaComplete();
      expect(hardware.ram.getU32(0x2000 + bank * 8)).toBe(0x12345670 + bank);
      expect(hardware.ram.getU32(0x2004 + bank * 8)).toBe(0xfedcba90 + bank);
    }
    expect(hardware.saveDirty).toBe(true);
    expect(fatalError()).toBeNull();
  });
});
