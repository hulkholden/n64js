import { describe, expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless_env.js';
import { OS_TV_NTSC } from '../system_constants.js';

function createEmulator(cartridge = 'Photopie', save) {
  return createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { cic: '6102', tvType: OS_TV_NTSC, cartridge, save },
  });
}

describe('Photopie empty SmartMedia slots', () => {
  test('replays the ROM startup exchange with both slots empty', async () => {
    const { hardware, fatalError } = await createEmulator();
    for (const [base, seed, response] of [
      [0xafe70100, 0xfff0, 0x5994],
      [0xafe70140, 0xc000, 0x47d6],
    ]) {
      const device = hardware.memMap.getMemoryHandler(base);
      device.write32(base + 0x3c, 1);
      device.write32(base + 0x3c, 0);
      expect(device.readU32(base + 0x20)).toBe(seed & 0xff);
      expect(device.readU32(base + 0x24)).toBe(seed >>> 8);
      device.write32(base + 0x20, response & 0xff);
      device.write32(base + 0x24, response >>> 8);
      expect(device.readU32(base)).toBe(0x47);
      expect(device.readU32(base + 0x08)).toBe(0xff);
      expect(device.readU32(base + 0x04) & 4).toBe(0);
      // Response latches must not overwrite the read-side challenge.
      expect(device.readU32(base + 0x20)).toBe(seed & 0xff);
      expect(device.readU32(base + 0x24)).toBe(seed >>> 8);
    }
    expect(hardware.saveMem).toBeNull();
    expect(hardware.saveDirty).toBe(false);
    expect(fatalError()).toBeNull();
  });

  test('keeps independent write latches and resets them without inserting media', async () => {
    const { hardware } = await createEmulator();
    const device = hardware.romD2A2Device;
    device.write32(0xafe7013c, 1);
    device.write32(0xafe70120, 0x94);
    device.write32(0xafe70124, 0x59);
    device.write32(0xafe7017c, 1);
    device.write32(0xafe7017c, 0);
    device.write32(0xafe70160, 0xd6);
    device.write32(0xafe70164, 0x47);
    expect(device.photopie.slots).toEqual([
      { seed: 0xfff0, responseLow: 0x94, responseHigh: 0x59, unlock: 1 },
      { seed: 0xc000, responseLow: 0xd6, responseHigh: 0x47, unlock: 0 },
    ]);
    hardware.reset();
    expect(device.photopie.slots).toEqual([
      { seed: 0xfff0, responseLow: 0, responseHigh: 0, unlock: 0 },
      { seed: 0xc000, responseLow: 0, responseHigh: 0, unlock: 0 },
    ]);
    expect(device.readU32(0xafe70100)).toBe(0x47);
    expect(device.readU32(0xafe70140)).toBe(0x47);
  });

  test('does not claim media commands or undocumented registers are supported', async () => {
    const { hardware } = await createEmulator();
    const device = hardware.romD2A2Device;
    for (const base of [0xafe70100, 0xafe70140]) {
      for (const command of [0x00, 0x10, 0x50, 0x60, 0x70, 0x80, 0x90, 0xd0, 0xff]) {
        expect(() => device.write32(base + 4, command)).toThrow('unsupported no-media write');
      }
      expect(() => device.readU32(base + 0x0c)).toThrow('unsupported no-media read');
      expect(() => device.write32(base + 0x28, 1)).toThrow('unsupported no-media write');
      expect(() => device.readU32(base + 0x21)).toThrow('unsupported no-media read');
      expect(device.readU32(base)).toBe(0x47);
    }
    // No broad write suppression around the slot register window.
    for (const address of [0xafe70000, 0xafe700fc, 0xafe70180, 0xafe701bc]) {
      expect(() => device.write32(address, 1)).toThrow('Writing s32 to rom');
    }
  });

  test('detaches the mapper when another cartridge is loaded into the same hardware', async () => {
    const { hardware } = await createEmulator();
    hardware.rominfo.cartridge = undefined;
    hardware.rominfo.save = 'SRAM';
    hardware.reset();
    expect(hardware.romD2A2Device.photopie).toBeNull();
    expect(() => hardware.romD2A2Device.write32(0xafe7013c, 1)).toThrow('Writing s32 to rom');
    hardware.romD2A2Device.write32(0xa8000000, 0x12345678);
    expect(hardware.saveMem.getU32(0)).toBe(0x12345678);
  });

  test('leaves ordinary cartridges on the existing bus and save paths', async () => {
    for (const save of [undefined, 'SRAM', 'SRAM96k', 'FlashRam']) {
      const { hardware } = await createEmulator('ordinary', save);
      expect(hardware.romD2A2Device.photopie).toBeNull();
      // Unmapped reads keep their existing address-derived open-bus value.
      expect(hardware.romD2A2Device.readU32(0xafe70100)).toBe(0x01000100);
    }
  });
});
