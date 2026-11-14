import { describe, expect, test } from 'bun:test';
import { createInputDriver, createRandom, parseInputScript } from './inventory_input.js';

describe('inventory input', () => {
  test('holds complete scripted states for exact VI durations before starting the seeded sequence', () => {
    const script = parseInputScript({
      version: 1,
      steps: [
        { frames: 2 },
        { frames: 2, buttons: ['start'] },
        { frames: 1 },
        { frames: 2, buttons: ['A', 'Z'], stickX: 80, stickY: -48 },
      ],
    });
    const drive = (seed, prefix, frames) => {
      const update = createInputDriver(seed, prefix);
      const input = { buttons: 0, stick_x: 0, stick_y: 0 };
      return Array.from({ length: frames }, (_, index) => {
        update(index + 1, input);
        return { ...input };
      });
    };
    const sequence = drive(123, script, 127);
    const neutral = { buttons: 0, stick_x: 0, stick_y: 0 };
    const start = { ...neutral, buttons: 0x1000 };
    const action = { buttons: 0xa000, stick_x: 80, stick_y: -48 };
    expect(sequence.slice(0, 7)).toEqual([neutral, neutral, start, start, neutral, action, action]);
    expect(sequence.slice(7)).toEqual(drive(123, undefined, 120));
    expect(drive(124, script, 127).slice(0, 7)).toEqual(sequence.slice(0, 7));
    expect(drive(124, script, 127).slice(7)).not.toEqual(sequence.slice(7));
  });

  test('normalizes case, duplicates, ordering across all buttons, and boundary stick values', () => {
    const parsed = parseInputScript({
      version: 1,
      steps: [
        {
          frames: 1,
          buttons: ['c_right', 'a', 'B', 'z', 'start', 'up', 'down', 'left', 'right', 'l', 'r', 'c_up', 'c_down', 'c_left', 'A', 'START'],
          stickX: -128,
          stickY: 127,
        },
      ],
    });
    expect(parsed).toEqual({
      version: 1,
      steps: [
        {
          frames: 1,
          buttons: ['A', 'B', 'C_DOWN', 'C_LEFT', 'C_RIGHT', 'C_UP', 'DOWN', 'L', 'LEFT', 'R', 'RIGHT', 'START', 'UP', 'Z'],
          stickX: -128,
          stickY: 127,
        },
      ],
    });

    const update = createInputDriver(1, parsed);
    const input = { buttons: 0, stick_x: 0, stick_y: 0 };
    update(1, input);
    expect(input).toEqual({ buttons: 0xff3f, stick_x: -128, stick_y: 127 });
  });

  test('rejects ambiguous or invalid scripts instead of silently changing their meaning', () => {
    for (const invalid of [
      null,
      [],
      { version: 2, steps: [{ frames: 1 }] },
      { version: 1, steps: [] },
      { version: 1, steps: 'invalid' },
      { version: 1, steps: [{ frames: 1 }], loop: true },
      ...[
        null,
        [],
        { frames: 0 },
        { frames: 1.5 },
        { frames: '1' },
        { frames: 1, button: 'A' },
        { frames: 1, buttons: ['STRAT'] },
        { frames: 1, buttons: [123] },
        { frames: 1, buttons: null },
        { frames: 1, stickX: 128 },
        { frames: 1, stickX: -129 },
        { frames: 1, stickX: 1.5 },
        { frames: 1, stickY: -129 },
        { frames: 1, stickY: null },
      ].map(step => ({ version: 1, steps: [step] })),
      { version: 1, steps: [{ frames: Number.MAX_SAFE_INTEGER }, { frames: 1 }] },
    ]) {
      expect(() => parseInputScript(invalid)).toThrow();
    }
  });

  test('replays holds and releases independently of CPU random consumption', () => {
    function sequence(seed, cpuReads) {
      const random = createRandom(seed);
      const update = createInputDriver(seed);
      const input = { buttons: 0, stick_x: 0, stick_y: 0 };
      return Array.from({ length: 1200 }, (_, index) => {
        for (let i = 0; i < cpuReads; i++) {
          random();
        }
        update(index + 1, input);
        return { ...input };
      });
    }
    const replay = sequence(0, 0);
    const random = createRandom(0);
    expect(Array.from({ length: 1000 }, random).every(value => value >= 0 && value < 1)).toBe(true);
    expect(sequence(0, 3)).toEqual(replay);
    expect(sequence(123, 0)).not.toEqual(replay);
    expect(replay.some(input => input.buttons === 0x1000)).toBe(true);
    expect(replay.some(input => input.buttons === 0x8000)).toBe(true);
    expect(replay.every(input => Math.abs(input.stick_x) <= 80 && Math.abs(input.stick_y) <= 80)).toBe(true);
    expect(replay.some((input, index) => input.buttons && input.buttons === replay[index + 1]?.buttons)).toBe(true);
    expect(replay.some((input, index) => index > 0 && replay[index - 1].buttons && input.buttons === 0 && input.stick_x === 0 && input.stick_y === 0)).toBe(true);
  });
});
