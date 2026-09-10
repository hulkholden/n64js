import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AIRegDevice } from './ai.js';
import { MI_INTR_AI, MI_INTR_REG } from './mi.js';
import { EventQueue } from '../event_queue.js';
import { MemoryRegion } from '../memory_region.js';
import { Timeline } from '../timeline.js';

const base = 0xa4500000;
const lengthReg = base + 0x04;
const statusReg = base + 0x0c;
const dacRateReg = base + 0x10;
const busy = 0x40000000;
const full = 0x80000000;
const clocks = [
  ['NTSC', 48_681_812, 22047],
  ['PAL', 49_656_530, 22489],
  ['MPAL', 48_628_316, 22023],
];

let previousN64js;
let hardware;
let events;
let ai;

beforeEach(() => {
  previousN64js = globalThis.n64js;
  events = new EventQueue();
  hardware = {
    headless: true,
    systemFrequency: 93_750_000,
    viRegDevice: { videoClock: clocks[0][1] },
    ai_reg: new MemoryRegion(new ArrayBuffer(0x20)),
    mi_reg: new MemoryRegion(new ArrayBuffer(0x10)),
    timeline: new Timeline(() => 0),
  };
  globalThis.n64js = {
    hardware: () => hardware,
    cpu0: {
      addEvent: events.addEvent.bind(events),
      getCyclesUntilEvent: events.getCyclesUntilEvent.bind(events),
      updateCause3() {},
    },
    warn: message => { throw new Error(message); },
  };
  ai = new AIRegDevice(hardware, base, base + 0x20);
});

afterEach(() => {
  if (previousN64js === undefined) delete globalThis.n64js;
  else globalThis.n64js = previousN64js;
});

describe('AI DMA timing', () => {
  for (const [region, videoClock, sampleRate] of clocks) {
    test(`${region}: keeps a 10 ms buffer busy for 10 ms of CPU cycles`, () => {
      hardware.viRegDevice.videoClock = videoClock;
      // 320 stereo 16-bit frames at 32 kHz last 10 ms, or 937,500 CPU cycles.
      ai.frequency = 32000;
      ai.write32(lengthReg, 1280);
      expect(events.getCyclesUntilEvent('AI DMA')).toBe(937500);
      events.incrementCount(468750);
      expect(ai.readU32(lengthReg)).toBe(640);
      expect(ai.readU32(statusReg) & busy).toBe(busy);
      events.incrementCount(468749);
      expect(ai.readU32(statusReg) & busy).toBe(busy);
      events.incrementCount(1);
      expect(ai.readU32(lengthReg)).toBe(0);
      expect(ai.readU32(statusReg) & busy).toBe(0);
      expect(events.hasEvent('AI DMA')).toBe(false);
    });

    test(`${region}: still derives the sample rate from the video clock`, () => {
      hardware.viRegDevice.videoClock = videoClock;
      ai.write32(dacRateReg, 2207);
      expect(ai.frequency).toBe(sampleRate);
    });
  }

  test('starts the queued buffer and raises its interrupt when the first buffer finishes', () => {
    ai.frequency = 32000;
    ai.write32(base, 0x1000);
    ai.write32(lengthReg, 1280);
    ai.write32(base, 0x2000);
    ai.write32(lengthReg, 640);
    expect(ai.readU32(statusReg) >>> 31).toBe(1);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_AI).toBe(MI_INTR_AI);
    ai.write32(statusReg, 0);
    events.incrementCount(937499);
    expect(ai.readU32(statusReg) >>> 31).toBe(1);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_AI).toBe(0);
    events.incrementCount(1);
    expect(ai.dmaAddresses[0]).toBe(0x2000);
    expect(ai.readU32(statusReg) & full).toBe(0);
    expect(ai.readU32(statusReg) & busy).toBe(busy);
    expect(ai.readU32(lengthReg)).toBe(640);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_AI).toBe(MI_INTR_AI);
    expect(events.getCyclesUntilEvent('AI DMA')).toBe(468750);
    events.incrementCount(468750);
    expect(ai.readU32(statusReg) & busy).toBe(0);
    expect(ai.readU32(lengthReg)).toBe(0);
  });
});
