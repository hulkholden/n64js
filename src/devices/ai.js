/*global n64js*/

import { Device } from './device.js';
import * as mi from './mi.js';
import * as logger from '../logger.js';
import { toString32 } from '../format.js';
import { TrackAudio } from '../timeline.js';

// Audio Interface
const AI_DRAM_ADDR_REG = 0x00;
const AI_LEN_REG = 0x04;
const AI_CONTROL_REG = 0x08;
const AI_STATUS_REG = 0x0C;
const AI_DACRATE_REG = 0x10;
const AI_BITRATE_REG = 0x14;

const AI_STATUS_FIFO_FULL0 = 0x0000_00001;
const AI_STATUS_UNKNOWN = 0x0110_0000;
const AI_STATUS_DMA_ENABLED = 0x0200_0000;
const AI_STATUS_DMA_BUSY = 0x4000_0000;
const AI_STATUS_FIFO_FULL = 0x8000_0000;

const addrWritableBits = 0x00ff_fff8;
const lenWritableBits = 0x0003_fff8;

const kAIDMAEvent = 'AI DMA';

const kDynamicRateMax = 0.005;

// https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/AudioBuffer
const kMinSampleRate = 3000
const kMaxSampleRate = 96000;

// The maximum amount of time audio can lead realtime, in seconds.
// If we exceed this we start skipping frames to allow the world to catch up.
const kMaxAudioLead = 0.100;

// How often to log sync status, in seconds. Zero to disable.
const kLogInterval = 5;

function clampSampleRate(r) {
  if (r < kMinSampleRate) { return kMinSampleRate; }
  if (r > kMaxSampleRate) { return kMaxSampleRate; }
  return r;
}

export class AIRegDevice extends Device {
  constructor(hardware, rangeStart, rangeEnd) {
    super("AIReg", hardware, hardware.ai_reg, rangeStart, rangeEnd);
    this.audioContext = new window.AudioContext();

    // Writes to the address register are latched until a subsequent write to the length reg.
    this.pendingAddress = 0;

    // DMAs are double-buffered.
    this.dmaAddresses = new Uint32Array(2);
    this.dmaLengths = new Uint32Array(2);
    this.dmaDurations = new Uint32Array(2);
    this.dmaCount = 0;

    // Values derived from the AI registers.
    this.dmaEnable = false;
    this.dacRate = 0;
    this.bitRate = 0xf;
    this.precision = 16;
    this.frequency = 32000;

    // State for managing audio playback.
    this.time = 0;
    this.dynamicRate = 1.0;

    this.lastLogTime = 0;
  }

  readU32(address) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }
    if (!this.quiet) { logger.log(`Read from ${toString32(ea)}`); }

    if (ea == AI_STATUS_REG) {
      let status = AI_STATUS_UNKNOWN;
      status |= this.dmaEnable ? AI_STATUS_DMA_ENABLED : 0;
      status |= (this.dmaCount > 0) ? AI_STATUS_DMA_BUSY : 0;
      status |= (this.dmaCount > 1) ? AI_STATUS_FIFO_FULL : 0;
      status |= (this.dmaCount > 1) ? AI_STATUS_FIFO_FULL0 : 0;
      return status;
    }

    // All other reads return the current length.
    return this.dmaLengthRemaining() >>> 0;
  }

  write32(address, value) {
    const ea = this.calcWriteEA(address);
    if (ea + 4 > this.u8.length) {
      throw 'Write is out of range';
    }

    switch (ea) {
      case AI_DRAM_ADDR_REG:
        if (!this.quiet) { logger.log(`Wrote to AI_DRAM_ADDR_REG: ${toString32(value)}`); }
        this.pendingAddress = value & addrWritableBits;
        break;
      case AI_LEN_REG:
        if (!this.quiet) { logger.log(`Wrote to AI_LEN_REG: ${toString32(value)}`); }
        this.pushDMA(value & lenWritableBits);
        break;
      case AI_CONTROL_REG:
        if (!this.quiet) { logger.log(`Wrote to AI_CONTROL_REG: ${toString32(value)}`); }
        this.dmaEnable = (value & 1) != 0;
        break;
      case AI_STATUS_REG:
        this.clearAI();
        break;

      case AI_DACRATE_REG:
        {
          this.dacRate = value & 0x3fff;
          this.frequency = Math.max(1, this.viClock / (this.dacRate + 1)) >> 0;
          // this.period = this.hardware.system.frequency / this.frequency;
          if (!this.quiet) { logger.log(`AI dacrate changed to ${this.dacRate}, vi clock is ${this.viClock}, freq ${this.frequency}`); }
        }
        break;
      case AI_BITRATE_REG:
        if (!this.quiet) { logger.log(`Wrote to AI_BITRATE_REG: ${toString32(value)}`); }
        this.bitRate = value & 0xf;
        this.precision = this.bitRate + 1;
        break;
      default:
        logger.log(`Unhandled write to AIReg: ${toString32(value)} -> [${toString32(address)}]`);
        break;
    }
  }

  get viClock() {
    return this.hardware.viRegDevice.videoClock;
  }

  pushDMA(length) {
    if (!length) {
      n64js.warn(`AI received zero length write`);
      return;
    }

    if (this.dmaCount >= 2) {
      n64js.warn(`AI DMA FIFO is full`);
      return;
    }

    this.dmaAddresses[this.dmaCount] = this.pendingAddress;
    this.dmaLengths[this.dmaCount] = length;
    this.dmaDurations[this.dmaCount] = this.estimateDMACyclesFromLength(length);
    this.dmaCount++;

    if (this.dmaCount == 1) {
      this.startPlayback();
    }
  }

  popDMA() {
    if (this.dmaCount <= 0) {
      n64js.warn('AI DMA underflow');
      return;
    }

    if (this.dmaCount == 2) {
      this.dmaAddresses[0] = this.dmaAddresses[1];
      this.dmaLengths[0] = this.dmaLengths[1];
      this.dmaDurations[0] = this.dmaDurations[1];
    }

    this.dmaCount--;
    if (this.dmaCount == 1) {
      this.startPlayback();
    }
  }

  estimateDMACyclesFromLength(length) {
    const bytesPerSample = ((this.bitRate + 1) << 1) / 8;
    const bytesPerSec = bytesPerSample * this.frequency;
    // TODO: is this VI clock or system clock?
    return (length * this.viClock / bytesPerSec) >>> 0;
  }

  startPlayback() {
    // TODO: emulate delayed carry bug.
    const address = this.dmaAddresses[0];
    const length = this.dmaLengths[0];
    const duration = this.dmaDurations[0];

    const numSamples = length / 4;

    const lSamples = new Float32Array(numSamples);
    const rSamples = new Float32Array(numSamples);
    const u8s = this.hardware.cachedMemDevice.u8;
    const dv = new DataView(u8s.buffer, address, length);
    for (let i = 0; i < numSamples; i++) {
      lSamples[i] = dv.getInt16(i * 4 + 0) / 0x8000;
      rSamples[i] = dv.getInt16(i * 4 + 2) / 0x8000;
    }

    // Apply dynamic rate control.
    // TOOD: implement this as described in https://github.com/libretro/libretro.github.com/raw/master/documents/ratecontrol.pdf.
    const currentTime = this.audioContext.currentTime;
    const timeDiff = this.time - currentTime;
    this.dynamicRate = (timeDiff > 0) ? +kDynamicRateMax : -kDynamicRateMax;
    const sampleRate = clampSampleRate(this.frequency * (1 + this.dynamicRate));

    if (kLogInterval > 0 && (currentTime - this.lastLogTime) > kLogInterval) {
      const leadOrLag = timeDiff > 0 ? 'leading' : 'lagging';
      console.log(`AI sync: timeDelta ${timeDiff}, ${leadOrLag}, dynamic ${this.dynamicRate}, ${this.frequency} -> ${sampleRate}`);
      this.lastLogTime = currentTime;
    }

    const ab = new AudioBuffer({ length: numSamples, sampleRate: sampleRate, numberOfChannels: 2 });
    ab.copyToChannel(lSamples, 0);
    ab.copyToChannel(rSamples, 1);

    const source = new AudioBufferSourceNode(this.audioContext, { buffer: ab });
    source.connect(this.audioContext.destination);
    source.start(this.time);
    if (timeDiff < 0) {
      this.time = currentTime;
    }
    this.time += ab.duration;

    // An AI interrupt is triggered as soon as playback starts.
    this.raiseAI();
    this.addAIDMAEvent(duration);
  }

  shouldSkipFrame() {
    const timeDiff = this.time - this.audioContext.currentTime;
    return timeDiff > kMaxAudioLead;
  }

  dmaLengthRemaining() {
    if (this.dmaCount == 0 || this.dmaDurations[0] == 0) {
      return 0;
    }
    const cycles = n64js.cpu0.getCyclesUntilEvent(kAIDMAEvent);
    if (cycles <= 0) {
      return 0;
    }

    // Convert from cycles to bytes.
    const lenRemaining = (cycles * this.dmaLengths[0] / this.dmaDurations[0]);
    return lenRemaining & ~7;
  }

  addAIDMAEvent(cycles) {
    const ev = n64js.hardware().timeline.startEvent(`AI DMA`, TrackAudio);
    const that = this;
    n64js.cpu0.addEvent(kAIDMAEvent, cycles, () => {
      that.dmaComplete();
      if (ev) {
        ev.stop();
      }
    });
  }

  dmaComplete() {
    this.popDMA();
  }

  raiseAI() {
    this.hardware.mi_reg.setBits32(mi.MI_INTR_REG, mi.MI_INTR_AI);
    n64js.cpu0.updateCause3();
  }

  clearAI() {
    this.hardware.mi_reg.clearBits32(mi.MI_INTR_REG, mi.MI_INTR_AI);
    n64js.cpu0.updateCause3();
  }
}
