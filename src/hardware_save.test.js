import { Buffer } from 'node:buffer';
import { describe, expect, spyOn, test } from 'bun:test';
import { createHeadlessEmulator } from './headless/headless_env.js';
import { OS_TV_NTSC } from './system_constants.js';

async function createHardware(options = {}) {
  const { hardware } = await createHeadlessEmulator({
    romBuffer: new ArrayBuffer(0x1000),
    rominfo: { id: 'test', name: 'Save test', cic: '6102', tvType: OS_TV_NTSC, save: 'FlashRam' },
  }, options);
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

  test('keeps failed saves pending, throttles retries and saves the latest data after recovery', async () => {
    const warnings = [];
    const hardware = await createHardware({ onWarning: message => warnings.push(message) });
    let now = 100;
    let full = true;
    const stored = new Map([['mempack0', { data: 'previous save' }]]);
    const time = spyOn(performance, 'now').mockImplementation(() => now);
    const write = spyOn(n64js, 'setLocalStorageItem').mockImplementation((name, data) => {
      if (full && name !== 'mempack1') {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      }
      stored.set(name, data);
    });
    try {
      hardware.saveMem.u8[0] = 0x12;
      hardware.saveDirty = true;
      hardware.mempacks[0].data[0] = 0x34;
      hardware.mempacks[0].dirty = true;
      hardware.mempacks[1].dirty = true;
      expect(() => hardware.verticalBlank()).not.toThrow();
      expect(hardware.verticalBlankCount).toBe(1);
      expect(hardware.saveDirty).toBe(true);
      expect(hardware.mempacks[0].dirty).toBe(true);
      expect(hardware.saveMem.u8[0]).toBe(0x12);
      expect(hardware.mempacks[0].data[0]).toBe(0x34);
      expect(stored.get('mempack0')).toEqual({ data: 'previous save' });
      expect(hardware.mempacks[1].dirty).toBe(false);
      expect(stored.has('mempack1')).toBe(true);
      expect(write).toHaveBeenCalledTimes(3);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Browser storage is full');
      expect(warnings[0]).toContain('only held in memory');

      for (let frame = 0; frame < 60; frame++) {
        now += 16;
        hardware.verticalBlank();
      }
      expect(write).toHaveBeenCalledTimes(3);

      now = 5_100;
      hardware.verticalBlank();
      expect(write).toHaveBeenCalledTimes(5);
      expect(warnings).toHaveLength(1);

      // Gameplay can change the pending data while storage is unavailable.
      hardware.saveMem.u8[0] = 0x56;
      hardware.mempacks[0].data[0] = 0x78;
      full = false;
      now = 10_100;
      hardware.verticalBlank();
      expect(write).toHaveBeenCalledTimes(7);
      expect(hardware.saveDirty).toBe(false);
      expect(hardware.mempacks[0].dirty).toBe(false);
      expect(Uint8Array.fromBase64(stored.get('save').data)).toEqual(hardware.saveMem.u8);
      expect(Uint8Array.fromBase64(stored.get('mempack0').data)).toEqual(hardware.mempacks[0].data);
      hardware.verticalBlank();
      expect(write).toHaveBeenCalledTimes(7);

      // A new failure after successful recovery must warn again.
      full = true;
      hardware.mempacks[0].dirty = true;
      hardware.verticalBlank();
      expect(hardware.mempacks[0].dirty).toBe(true);
      expect(warnings).toHaveLength(2);
    } finally {
      time.mockRestore();
      write.mockRestore();
    }
  });

  test('handles blocked storage without reporting that it is full', async () => {
    const warnings = [];
    const hardware = await createHardware({ onWarning: message => warnings.push(message) });
    const write = spyOn(n64js, 'setLocalStorageItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });
    try {
      hardware.mempacks[0].dirty = true;
      expect(() => hardware.verticalBlank()).not.toThrow();
      expect(hardware.mempacks[0].dirty).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Browser storage could not be written');
    } finally {
      write.mockRestore();
    }
  });
});
