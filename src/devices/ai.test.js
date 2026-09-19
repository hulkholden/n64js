import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AIRegDevice } from './ai.js';
import { MI_INTR_AI, MI_INTR_REG } from './mi.js';
import { EventQueue } from '../event_queue.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { Timeline } from '../debug/timeline.js';

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

describe('browser audio scheduling', () => {
  let previousAudioBuffer;
  let previousAudioBufferSourceNode;
  let context;
  let sources;

  beforeEach(() => {
    previousAudioBuffer = globalThis.AudioBuffer;
    previousAudioBufferSourceNode = globalThis.AudioBufferSourceNode;
    context = { currentTime: 0, state: 'running', destination: {} };
    sources = [];
    hardware.headless = false;
    hardware.cachedMemDevice = new MemoryRegion(new ArrayBuffer(0x4000));
    ai.audioContext = context;
    ai.frequency = 32000;

    globalThis.AudioBuffer = class {
      constructor({ length, sampleRate }) {
        this.sampleRate = sampleRate;
        this.duration = length / sampleRate;
        this.channels = [];
      }
      copyToChannel(samples, channel) { this.channels[channel] = samples; }
    };
    globalThis.AudioBufferSourceNode = class {
      constructor(audioContext, { buffer }) {
        this.buffer = buffer;
        sources.push(this);
      }
      connect() {}
      disconnect() { this.disconnected = true; }
      start(time) { this.startTime = time; }
      stop() { this.stopped = true; }
      get endTime() { return this.startTime + this.buffer.duration; }
    };
  });

  afterEach(() => {
    if (previousAudioBuffer === undefined) delete globalThis.AudioBuffer;
    else globalThis.AudioBuffer = previousAudioBuffer;
    if (previousAudioBufferSourceNode === undefined) delete globalThis.AudioBufferSourceNode;
    else globalThis.AudioBufferSourceNode = previousAudioBufferSourceNode;
  });

  test('starts with a playback cushion while preserving emulated DMA timing and samples', () => {
    const samples = new DataView(hardware.cachedMemDevice.u8.buffer);
    samples.setInt16(0, -32768);
    samples.setInt16(2, 16384);
    ai.write32(lengthReg, 1280);
    expect(sources[0].startTime).toBeCloseTo(0.050);
    expect(sources[0].buffer.channels[0][0]).toBe(-1);
    expect(sources[0].buffer.channels[1][0]).toBe(0.5);
    expect(events.getCyclesUntilEvent('AI DMA')).toBe(937500);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_AI).toBe(MI_INTR_AI);
  });

  test('queues successive buffers without gaps or overlap', () => {
    ai.write32(lengthReg, 1280);
    ai.write32(lengthReg, 1280);
    context.currentTime = 0.008;
    events.incrementCount(937500);
    expect(sources[1].startTime).toBe(sources[0].endTime);
    expect(ai.time).toBe(sources[1].endTime);
  });

  for (const [lead, direction] of [[0.010, -1], [0.050, 0], [0.090, 1]]) {
    test(`rate control preserves the target cushion with ${lead}s queued`, () => {
      ai.time = lead;
      ai.write32(lengthReg, 1280);
      expect(Math.sign(sources[0].buffer.sampleRate - ai.frequency)).toBe(direction);
      expect(Math.abs(ai.dynamicRate)).toBeLessThanOrEqual(0.005);
    });
  }

  test('rebuilds the cushion after an underrun instead of scheduling in the past', () => {
    context.currentTime = 1;
    ai.time = 0.9;
    ai.write32(lengthReg, 1280);
    expect(sources[0].startTime).toBeCloseTo(1.050);
    expect(ai.time).toBe(sources[0].endTime);
  });

  test('sustains jittery callbacks without gradually draining the queue', () => {
    ai.frequency = 22047;
    const length = 736 * 4;
    const duration = 736 / ai.frequency;
    const jitter = [0, 0.012, 0.004, 0.020, 0];
    for (let i = 0; i < 1800; i++) {
      context.currentTime = i * duration + jitter[i % jitter.length];
      ai.write32(lengthReg, length);
      expect(sources[i].startTime - context.currentTime).toBeGreaterThan(0.015);
      if (i > 0) expect(sources[i].startTime).toBe(sources[i - 1].endTime);
      events.incrementCount(ai.dmaDurations[0]);
    }
  });

  test('does not throttle emulation while the audio clock is suspended', () => {
    ai.time = 0.2;
    expect(ai.shouldSkipFrame()).toBe(true);
    context.state = 'suspended';
    expect(ai.shouldSkipFrame()).toBe(false);
  });

  test('keeps DMA moving while suspended and resumes with fresh output', () => {
    ai.write32(lengthReg, 1280);
    ai.write32(lengthReg, 1280);
    context.state = 'suspended';
    ai.write32(statusReg, 0);
    events.incrementCount(937500);
    expect(sources).toHaveLength(1);
    expect(sources[0].stopped).toBe(true);
    expect(ai.time).toBe(0);
    expect(events.getCyclesUntilEvent('AI DMA')).toBe(937500);
    expect(hardware.mi_reg.getU32(MI_INTR_REG) & MI_INTR_AI).toBe(MI_INTR_AI);
    ai.write32(lengthReg, 1280);
    context.state = 'running';
    context.currentTime = 2;
    events.incrementCount(937500);
    expect(sources).toHaveLength(2);
    expect(sources[1].startTime).toBeCloseTo(2.050);
  });

  test('releases sources after playback ends', () => {
    ai.write32(lengthReg, 1280);
    sources[0].onended();
    expect(sources[0].disconnected).toBe(true);
    expect(ai.sources.size).toBe(0);
  });

  test('reset clears DMA state and stops audio left over from the previous ROM', () => {
    ai.write32(base, 0x1000);
    ai.write32(lengthReg, 1280);
    ai.write32(lengthReg, 1280);
    // Hardware resets the CPU event queue before resetting its devices.
    events.reset();
    ai.reset();
    expect(ai.dmaCount).toBe(0);
    expect(ai.pendingAddress).toBe(0);
    expect(ai.time).toBe(0);
    expect(ai.readU32(statusReg) & (busy | full)).toBe(0);
    expect(sources[0].stopped).toBe(true);
    expect(sources[0].disconnected).toBe(true);
    ai.write32(lengthReg, 1280);
    expect(events.hasEvent('AI DMA')).toBe(true);
  });
});
