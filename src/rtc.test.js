import { describe, expect, test } from 'bun:test';
import { CartridgeRTC } from './rtc.js';
import { romHasRTC } from './romdb.js';

const run = [3, 0, 0, 0, 0, 0, 0, 0];
const stop = [0, 4, 0, 0, 0, 0, 0, 0];

function fixture() {
  let now = new Date(2024, 1, 28, 23, 59, 59).getTime();
  const clock = () => now;
  const rtc = new CartridgeRTC(clock);
  return { rtc, clock, advance: milliseconds => { now += milliseconds; } };
}

describe('cartridge RTC', () => {
  test('seeds local civil time and advances across leap day', () => {
    const { rtc, advance } = fixture();
    expect([...rtc.readBlock(2)]).toEqual([0x59, 0x59, 0xa3, 0x28, 3, 2, 0x24, 1]);
    advance(999);
    expect(rtc.readBlock(2)[0]).toBe(0x59);
    advance(1);
    expect([...rtc.readBlock(2)]).toEqual([0, 0, 0x80, 0x29, 4, 2, 0x24, 1]);
    advance(86_400_000);
    expect([...rtc.readBlock(2)]).toEqual([0, 0, 0x80, 1, 5, 3, 0x24, 1]);
  });

  test('performs the libdragon stop, set, read-back, resume sequence', () => {
    const { rtc, advance } = fixture();
    expect(rtc.status).toBe(0);
    expect([...rtc.readBlock(0)]).toEqual(run);
    expect(rtc.writeBlock(0, stop)).toBe(true);
    expect(rtc.status).toBe(0x80);
    const target = [3, 2, 0x81, 3, 1, 0x11, 3, 1]; // 2003-11-03 Monday
    expect(rtc.writeBlock(2, target)).toBe(true);
    advance(3_600_000);
    expect([...rtc.readBlock(2)]).toEqual(target);
    rtc.writeBlock(0, run);
    expect(rtc.status).toBe(0);
    advance(1_000);
    expect([...rtc.readBlock(2)]).toEqual([4, ...target.slice(1)]);
  });

  test('repeated stop writes do not advance a stopped clock or lose fractional seconds', () => {
    const { rtc, advance } = fixture();
    advance(750);
    rtc.writeBlock(0, stop);
    advance(10_000);
    rtc.writeBlock(0, stop);
    advance(10_000);
    rtc.writeBlock(0, run);
    advance(249);
    expect(rtc.readBlock(2)[0]).toBe(0x59);
    advance(1);
    expect(rtc.readBlock(2)[0]).toBe(0);
  });

  test('keeps independently writable data and time blocks behind their protection bits', () => {
    const { rtc } = fixture();
    const data = [0xff, 0x80, 1, 2, 3, 4, 5, 6];
    const target = [0, 0, 0x80, 1, 6, 1, 0, 1];
    const originalTime = rtc.readBlock(2);
    rtc.writeBlock(0, [2, 4, 0, 0, 0, 0, 0, 0]); // Time protected, data writable.
    rtc.writeBlock(1, data);
    rtc.writeBlock(2, target);
    expect([...rtc.readBlock(1)]).toEqual(data);
    expect(rtc.readBlock(2)).toEqual(originalTime);
    rtc.writeBlock(0, [1, 4, 0, 0, 0, 0, 0, 0]); // Data protected, time writable.
    rtc.writeBlock(1, Array(8).fill(0));
    rtc.writeBlock(2, target);
    expect([...rtc.readBlock(1)]).toEqual(data);
    expect([...rtc.readBlock(2)]).toEqual(target);
  });

  test('unlocked time writes require the clock to be stopped', () => {
    const { rtc } = fixture();
    rtc.writeBlock(0, Array(8).fill(0));
    const before = rtc.readBlock(2);
    rtc.writeBlock(2, [0, 0, 0x80, 1, 6, 1, 0, 1]);
    expect(rtc.readBlock(2)).toEqual(before);
  });

  test('preserves opaque control bytes and a separately programmed weekday', () => {
    const { rtc, advance } = fixture();
    const control = [0, 4, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc];
    rtc.writeBlock(0, control);
    expect([...rtc.readBlock(0)]).toEqual(control);
    rtc.writeBlock(2, [0x59, 0x59, 0xa3, 0x31, 6, 0x12, 0x99, 0]);
    rtc.writeBlock(0, run);
    advance(1_000);
    // Saturday rolls to Sunday even though 2000-01-01 was a Saturday.
    expect([...rtc.readBlock(2)]).toEqual([0, 0, 0x80, 1, 0, 1, 0, 1]);
    const copy = rtc.readBlock(0);
    copy[1] = 4;
    expect(rtc.status).toBe(0);
  });

  test('applies Gregorian century rules at 2100', () => {
    const { rtc, advance } = fixture();
    rtc.writeBlock(0, stop);
    rtc.writeBlock(2, [0x59, 0x59, 0xa3, 0x28, 0, 2, 0, 2]);
    rtc.writeBlock(0, run);
    advance(1_000);
    expect([...rtc.readBlock(2)]).toEqual([0, 0, 0x80, 1, 1, 3, 0, 2]);
  });

  test('rejects unsupported blocks, short writes, invalid BCD and invalid calendar dates atomically', () => {
    const { rtc } = fixture();
    rtc.writeBlock(0, stop);
    const before = rtc.serialize();
    expect(rtc.readBlock(3)).toBeNull();
    expect(rtc.writeBlock(255, run)).toBe(false);
    expect(rtc.writeBlock(0, [3, 0])).toBe(false);
    const valid = [0x59, 0x59, 0xa3, 0x29, 4, 2, 0x24, 1];
    for (const [index, value] of [[0, 0x5a], [0, 0x60], [1, 0x60], [2, 0xa4],
      [2, 0x23], [3, 0], [3, 0x30], [4, 7], [5, 0], [5, 0x13], [6, 0x23], [7, 0xfa]]) {
      const invalid = [...valid];
      invalid[index] = value;
      expect(rtc.writeBlock(2, invalid)).toBe(false);
      expect(rtc.serialize()).toEqual(before);
    }
  });

  for (const stopped of [false, true]) {
    test(`restores ${stopped ? 'stopped' : 'running'} state after time spent unloaded`, () => {
      const { rtc, clock, advance } = fixture();
      rtc.writeBlock(0, stop);
      rtc.writeBlock(1, [8, 7, 6, 5, 4, 3, 2, 1]);
      rtc.writeBlock(2, [0, 0, 0x80, 1, 0, 1, 0, 1]);
      if (!stopped) {
        rtc.writeBlock(0, run);
      }
      const saved = JSON.parse(JSON.stringify(rtc.serialize()));
      advance(86_400_000);
      const restored = new CartridgeRTC(clock, saved);
      expect(restored.dirty).toBe(false);
      expect(restored.readBlock(2)).toEqual(rtc.readBlock(2));
      expect([...restored.readBlock(2)]).toEqual([0, 0, 0x80, stopped ? 1 : 2, stopped ? 0 : 1, 1, 0, 1]);
      expect([...restored.readBlock(1)]).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
      expect(restored.status).toBe(stopped ? 0x80 : 0);
    });
  }

  test('ignores corrupt or unsupported saved states', () => {
    const { rtc, clock } = fixture();
    const good = rtc.serialize();
    for (const saved of [null, {}, { ...good, version: 2 }, { ...good, control: [0] },
      { ...good, data: Array(8).fill(-1) }, { ...good, clockMillis: null },
      { ...good, hostMillis: Infinity }, { ...good, hostMillis: -Number.MAX_SAFE_INTEGER },
      { ...good, weekdayOffset: 7 }]) {
      const restored = new CartridgeRTC(clock, saved);
      expect(restored.serialize()).toEqual(good);
      expect(restored.dirty).toBe(true);
    }
  });
});

describe('cartridge RTC presence', () => {
  test('recognizes Animal Forest and explicitly configured ED homebrew only', () => {
    const bytes = new Uint8Array(64);
    expect(romHasRTC(bytes)).toBe(false);
    bytes.set([0x4e, 0x41, 0x46, 0x4a, 0], 0x3b); // NAFJ
    expect(romHasRTC(bytes)).toBe(true);
    bytes[0x3b] = 0;
    expect(romHasRTC(bytes)).toBe(false);
    bytes.set([0x45, 0x44, 0, 0x10], 0x3c);
    expect(romHasRTC(bytes)).toBe(false);
    for (const flags of [1, 0x11, 0x21, 0x31, 0x51]) {
      bytes[0x3f] = flags;
      expect(romHasRTC(bytes)).toBe(true);
    }
    bytes[0x3d] = 0;
    expect(romHasRTC(bytes)).toBe(false);
    expect(romHasRTC(new Uint8Array(63))).toBe(false);
  });
});
