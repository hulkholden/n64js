import { describe, expect, test } from 'bun:test';
import { CartridgeRTC } from './cartridge_rtc.js';

const stopped = Uint8Array.of(0, 4, 0, 0, 0, 0, 0, 0);
const running = Uint8Array.of(3, 0, 0, 0, 0, 0, 0, 0);
const programmedTime = Uint8Array.of(0x03, 0x02, 0x81, 0x03, 1, 0x11, 0x03, 1);

describe('cartridge RTC calendar', () => {
  test('encodes local wall time as BCD with 24-hour and century fields', () => {
    const rtc = new CartridgeRTC(() => new Date(2024, 1, 29, 23, 48, 57).getTime());
    expect([...rtc.read(2)]).toEqual([0x57, 0x48, 0xa3, 0x29, 4, 0x02, 0x24, 1]);
  });

  for (const [year, month, day, expected] of [
    [1999, 12, 31, [0, 0, 0x80, 0x01, 6, 0x01, 0, 1]],
    [2000, 2, 28, [0, 0, 0x80, 0x29, 2, 0x02, 0, 1]],
    [2100, 2, 28, [0, 0, 0x80, 0x01, 1, 0x03, 0, 2]],
  ]) {
    test(`rolls over ${year}-${month}-${day} without losing subsecond progress`, () => {
      let now = new Date(year, month - 1, day, 23, 59, 59).getTime();
      const rtc = new CartridgeRTC(() => now);
      for (let i = 0; i < 9; i++) {
        now += 100;
        expect(rtc.read(2)[0]).toBe(0x59);
      }
      now += 100;
      expect([...rtc.read(2)]).toEqual(expected);
    });
  }

  test('increments a separately programmed weekday across several days', () => {
    let now = 0;
    const rtc = new CartridgeRTC(() => now);
    rtc.write(0, stopped);
    // Deliberately use Sunday for a date that was a Monday.
    rtc.write(2, Uint8Array.of(0x59, 0x59, 0xa3, 0x03, 0, 0x11, 0x03, 1));
    rtc.write(0, running);
    now += 2 * 86_400_000 + 1000;
    expect([...rtc.read(2)]).toEqual([0, 0, 0x80, 0x06, 3, 0x11, 0x03, 1]);
  });

  test('does not run backwards when the host clock is adjusted', () => {
    let now = new Date(2024, 0, 1).getTime();
    const rtc = new CartridgeRTC(() => now);
    const before = rtc.read(2);
    now -= 60_000;
    expect(rtc.read(2)).toEqual(before);
    now += 1000;
    expect(rtc.read(2)[0]).toBe(1);
  });
});

describe('cartridge RTC registers and persistence', () => {
  test('protects each writable block independently', () => {
    const rtc = new CartridgeRTC(() => 0);
    const originalTime = rtc.read(2);
    const data = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
    expect(rtc.write(1, data)).toBe(true);
    expect(rtc.write(2, programmedTime)).toBe(true);
    expect(rtc.read(1)).toEqual(new Uint8Array(8));
    expect(rtc.read(2)).toEqual(originalTime);

    rtc.write(0, Uint8Array.of(1, 4, 0, 0, 0, 0, 0, 0));
    rtc.write(1, data);
    rtc.write(2, programmedTime);
    expect(rtc.read(1)).toEqual(new Uint8Array(8));
    expect(rtc.read(2)).toEqual(programmedTime);

    rtc.write(0, Uint8Array.of(2, 4, 0, 0, 0, 0, 0, 0));
    rtc.write(1, data);
    rtc.write(2, originalTime);
    expect(rtc.read(1)).toEqual(data);
    expect(rtc.read(2)).toEqual(programmedTime);
  });

  test('preserves registers and advances only a running clock while unloaded', () => {
    let now = 0;
    for (const run of [false, true]) {
      const rtc = new CartridgeRTC(() => now);
      const control = Uint8Array.of(0, 4, 0xab, 0xcd, 1, 2, 3, 4);
      const data = Uint8Array.of(8, 7, 6, 5, 4, 3, 2, 1);
      rtc.write(0, control);
      rtc.write(1, data);
      rtc.write(2, programmedTime);
      if (run) { control.set([3, 0]); rtc.write(0, control); }
      const savedState = JSON.parse(JSON.stringify(rtc.save()));
      now += 86_400_000;
      const restored = new CartridgeRTC(() => now, savedState);
      expect(restored.read(0)).toEqual(control);
      expect(restored.read(1)).toEqual(data);
      expect([...restored.read(2)]).toEqual(run ?
        [0x03, 0x02, 0x81, 0x04, 2, 0x11, 0x03, 1] : [...programmedTime]);
      expect(restored.status).toBe(run ? 0 : 0x80);
      expect(restored.dirty).toBe(false);
    }
  });

  test('rejects unsupported blocks, incomplete writes, and invalid dates without changing state', () => {
    const rtc = new CartridgeRTC(() => 0);
    rtc.write(0, stopped);
    rtc.write(2, programmedTime);
    rtc.dirty = false;
    expect(rtc.read(3)).toBeNull();
    expect(rtc.write(3, programmedTime)).toBe(false);
    expect(rtc.write(2, programmedTime.slice(0, 7))).toBe(false);
    for (const [index, value] of [[0, 0x1a], [1, 0x60], [2, 0xa4], [3, 0x31], [4, 7], [5, 0x13]]) {
      const invalid = programmedTime.slice();
      invalid[index] = value;
      expect(rtc.write(2, invalid)).toBe(false);
    }
    expect(rtc.read(2)).toEqual(programmedTime);
    expect(rtc.dirty).toBe(false);
  });

  test('ignores malformed persisted data', () => {
    const now = () => new Date(2024, 0, 1).getTime();
    const rtc = new CartridgeRTC(now);
    for (const state of [{}, { ...rtc.save(), time: null }, { ...rtc.save(), control: [] }]) {
      const restored = new CartridgeRTC(now, state);
      expect(restored.read(2)).toEqual(rtc.read(2));
      expect(restored.dirty).toBe(true);
    }
  });
});
