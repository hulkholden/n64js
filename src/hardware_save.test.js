import { Buffer } from 'node:buffer';
import { describe, expect, spyOn, test } from 'bun:test';
import { createHeadlessEmulator } from './headless/headless_env.js';
import { OS_TV_NTSC } from './system_constants.js';

async function createHardware() {
  const { hardware } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id: 'test', name: 'Save test', cic: '6102', tvType: OS_TV_NTSC, save: 'FlashRam' },
  });
  return hardware;
}

describe('save persistence', () => {
  test('flushes a full FlashRAM save on vertical blank and restores every byte', async () => {
    const hardware = await createHardware();
    const bytes = Uint8Array.from({ length: 128 * 1024 }, (_, i) => (i * 17 + 3) & 0xff);
    const stored = new Map();
    const read = spyOn(n64js, 'getLocalStorageItem').mockImplementation(name => stored.get(name));
    const write = spyOn(n64js, 'setLocalStorageItem').mockImplementation((name, data) => stored.set(name, data));
    try {
      hardware.saveMem.u8.set(bytes);
      hardware.saveDirty = true;
      hardware.verticalBlank();
      expect(stored.get('save')).toEqual({
        id: 'test', name: 'Save test', data: Buffer.from(bytes).toString('base64'),
      });
      expect(hardware.saveDirty).toBe(false);
      hardware.verticalBlank();
      expect(write).toHaveBeenCalledTimes(1);

      hardware.saveMem.u8.fill(0);
      hardware.initSaveGame();
      expect(hardware.saveMem.u8).toEqual(bytes);
      expect(hardware.saveDirty).toBe(false);
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  test('serializes a large byte view without including surrounding bytes', async () => {
    const hardware = await createHardware();
    // The original argument spread overflows at 128 KiB in Chromium;
    // use 1 MiB here to reproduce it under Bun too.
    const backing = Uint8Array.from({ length: 1024 * 1024 + 32 }, (_, i) => (i * 17 + 3) & 0xff);
    const bytes = backing.subarray(13, 13 + 1024 * 1024);
    const write = spyOn(n64js, 'setLocalStorageItem');
    try {
      hardware.saveU8Array('save', bytes);
      expect(write).toHaveBeenCalledWith('save', {
        id: 'test', name: 'Save test', data: Buffer.from(bytes).toString('base64'),
      });
    } finally {
      write.mockRestore();
    }
  });
});
