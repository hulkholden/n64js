import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHeadlessEmulator, loadROMFile } from './headless/headless_env.js';
import { SI_DRAM_ADDR_REG, SI_PIF_ADDR_RD64B_REG, SI_PIF_ADDR_WR64B_REG, SI_STATUS_REG } from './devices/si.js';

const stop = [0, 4, 0, 0, 0, 0, 0, 0];
const run = [3, 0, 0, 0, 0, 0, 0, 0];
const target = [0x58, 0x59, 0xa3, 0x31, 6, 0x12, 0x22, 1];

async function fixture(rtc = true) {
  let now = new Date(2024, 0, 1).getTime();
  const rom = new ArrayBuffer(0x1000);
  const emulator = await createHeadlessEmulator({
    romBuffer: rom,
    rominfo: { id: 'first', cic: '6102', tvType: 1, save: 'Eeprom4k', rtc },
  }, { rtcNow: () => now });
  const { hardware, cpu0 } = emulator;
  const storage = new Map();
  n64js.getLocalStorageItem = name => storage.get(`${hardware.rominfo.id}:${name}`);
  n64js.setLocalStorageItem = (name, data) => {
    storage.set(`${hardware.rominfo.id}:${name}`, structuredClone(data));
  };
  function command(bytes, rx) {
    const frame = hardware.ram.u8.subarray(0x1000, 0x1040);
    frame.fill(0xcc);
    frame.fill(0, 0, 4);
    frame.set([bytes.length, rx, ...bytes], 4);
    frame[6 + bytes.length + rx] = 0xfe;
    frame[63] = 1;
    const si = hardware.siRegDevice;
    si.write32(0xa4800000 + SI_DRAM_ADDR_REG, 0x1000);
    for (const reg of [SI_PIF_ADDR_WR64B_REG, SI_PIF_ADDR_RD64B_REG]) {
      si.write32(0xa4800000 + reg, 0x1fc007c0);
      cpu0.incrementCount(0x900);
      cpu0.eventQueue.incrementCount(0x900);
      si.write32(0xa4800000 + SI_STATUS_REG, 0);
    }
    return { length: frame[5], data: [...frame.slice(6 + bytes.length, 6 + bytes.length + rx)] };
  }
  return { hardware, rom, storage, command, advance: ms => { now += ms; } };
}

describe('RTC hardware integration', () => {
  test('exposes explicit presence and the injected clock through the SI registers', async () => {
    const { command } = await fixture();
    expect(command([6], 3)).toEqual({ length: 3, data: [0, 0x10, 0] });
    expect(command([7, 2], 9)).toEqual({ length: 9, data: [0, 0, 0x80, 1, 1, 1, 0x24, 1, 0] });
    expect(command([8, 0, ...stop], 1)).toEqual({ length: 1, data: [0x80] });
    expect(command([8, 2, ...target], 1)).toEqual({ length: 1, data: [0x80] });
    expect(command([7, 2], 9)).toEqual({ length: 9, data: [...target, 0x80] });
    expect(command([0], 3)).toEqual({ length: 3, data: [0, 0x80, 0] });
  });

  test('leaves unconfigured cartridges absent and creates no RTC save', async () => {
    const { hardware, command, storage } = await fixture(false);
    expect(hardware.rtc).toBeNull();
    expect(command([6], 3)).toEqual({ length: 0x83, data: [0xcc, 0xcc, 0xcc] });
    hardware.flushSaveData();
    expect(storage.has('first:rtc')).toBe(false);
  });

  test('console reset preserves unsaved RTC changes and frozen time', async () => {
    const { hardware, command, advance } = await fixture();
    command([8, 0, ...stop], 1);
    command([8, 2, ...target], 1);
    const rtc = hardware.rtc;
    advance(60_000);
    hardware.reset();
    expect(hardware.rtc).toBe(rtc);
    expect(command([7, 2], 9).data).toEqual([...target, 0x80]);
    command([8, 0, ...run], 1);
    advance(2_000);
    expect(command([7, 2], 9).data).toEqual([0, 0, 0x80, 1, 0, 1, 0x23, 1, 0]);
  });

  for (const stopped of [false, true]) {
    test(`persists ${stopped ? 'stopped' : 'running'} time through cartridge reload`, async () => {
      const { hardware, command, storage, advance, rom } = await fixture();
      command([8, 0, ...stop], 1);
      command([8, 2, ...target], 1);
      if (!stopped) {
        command([8, 0, ...run], 1);
      }
      hardware.verticalBlank();
      const saved = storage.get('first:rtc');
      expect(saved.version).toBe(1);
      expect(hardware.rtc.dirty).toBe(false);
      advance(2_000);
      hardware.verticalBlank();
      expect(storage.get('first:rtc')).toBe(saved); // No per-frame storage churn.
      hardware.createROM(rom.slice(0));
      expect(hardware.rtc).toBeNull();
      hardware.reset();
      expect(command([7, 2], 9).data).toEqual(stopped ? [...target, 0x80] :
        [0, 0, 0x80, 1, 0, 1, 0x23, 1, 0]);
    });
  }

  test('flushes a replaced cartridge under its old identity and does not leak RTC presence', async () => {
    const { hardware, command, storage, rom } = await fixture();
    command([8, 0, ...stop], 1);
    command([8, 2, ...target], 1);
    hardware.createROM(rom.slice(0));
    hardware.rominfo.id = 'second';
    hardware.rominfo.rtc = false;
    hardware.reset();
    expect(storage.has('first:rtc')).toBe(true);
    expect(storage.has('second:rtc')).toBe(false);
    expect(command([6], 3).length).toBe(0x83);
    hardware.createROM(rom.slice(0));
    hardware.rominfo.id = 'first';
    hardware.rominfo.rtc = true;
    hardware.reset();
    expect(command([7, 2], 9).data).toEqual([...target, 0x80]);
  });

  test('loads RTC metadata from big-endian and byte-swapped ROMs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'n64js-rtc-'));
    try {
      const bytes = new Uint8Array(0x1000);
      bytes.set([0x80, 0x37, 0x12, 0x40]);
      bytes.set([0x4e, 0x41, 0x46, 0x4a, 0], 0x3b);
      const path = join(directory, 'header.z64');
      await writeFile(path, bytes);
      expect((await loadROMFile(path)).rominfo.rtc).toBe(true);
      bytes.set([0x45, 0x44, 0x45, 0x11], 0x3c);
      for (let i = 0; i < bytes.length; i += 2) {
        [bytes[i], bytes[i + 1]] = [bytes[i + 1], bytes[i]];
      }
      await writeFile(path, bytes);
      const loaded = await loadROMFile(path);
      expect(loaded.rominfo.rtc).toBe(true);
      const { hardware } = await createHeadlessEmulator(loaded);
      expect(hardware.rtc).not.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
