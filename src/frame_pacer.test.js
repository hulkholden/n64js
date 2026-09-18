import { describe, expect, test } from 'bun:test';
import { FramePacer } from './frame_pacer.js';

describe('browser frame pacing', () => {
  for (const videoRate of [50, 60]) {
    for (const displayRate of [30, 59, 60, 120, 144]) {
      test(`${videoRate} Hz video stays at real time on a ${displayRate} Hz display`, () => {
        const pacer = new FramePacer();
        let frames = 0;
        for (let i = 0; i <= displayRate * 10; i++) {
          frames += pacer.framesDue(i * 1000 / displayRate, videoRate);
        }
        expect(frames).toBe(1 + videoRate * 10);
      });
    }
  }

  test('catches up after a missed callback', () => {
    const pacer = new FramePacer();
    expect(pacer.framesDue(0, 60)).toBe(1);
    expect(pacer.framesDue(1000 / 60, 60)).toBe(1);
    expect(pacer.framesDue(3000 / 60, 60)).toBe(2);
    expect(pacer.framesDue(4000 / 60, 60)).toBe(1);
  });

  test('caps work after a long stall and discards excess backlog', () => {
    const pacer = new FramePacer();
    pacer.framesDue(0, 60);
    expect(pacer.framesDue(5000, 60)).toBe(3);
    expect(pacer.framesDue(5000 + 1000 / 60, 60)).toBe(1);
  });

  test('starts fresh after pausing or resetting', () => {
    const pacer = new FramePacer();
    pacer.framesDue(0, 60);
    pacer.framesDue(10, 60);
    pacer.reset();
    expect(pacer.framesDue(10000, 50)).toBe(1);
    expect(pacer.framesDue(10010, 50)).toBe(0);
    expect(pacer.framesDue(10020, 50)).toBe(1);
  });
});
