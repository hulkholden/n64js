const kBlockSize = 8;
const kControlStop = 0x0004;
const kProtectBlock1 = 0x0100;
const kProtectBlock2 = 0x0200;
const kStatusStopped = 0x80;
const kMillisecondsPerDay = 86_400_000;

// Cartridge RTC protocol used by Doubutsu no Mori and libdragon.
// https://github.com/DragonMinded/libdragon/blob/trunk/src/rtc.c
// Writes complete immediately; oscillator calibration is stored but not applied.
export class CartridgeRTC {
  constructor(now = Date.now, savedState = null) {
    this.now = now;
    this.control = new Uint8Array(kBlockSize);
    this.control[0] = (kProtectBlock1 | kProtectBlock2) >>> 8;
    this.data = new Uint8Array(kBlockSize);
    this.updatedAt = now();
    const date = new Date(this.updatedAt);
    // Seed from local wall time, then use UTC calendar arithmetic so subsequent
    // host timezone/DST changes don't adjust the cartridge's programmed clock.
    this.time = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(),
      date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
    this.weekday = date.getDay();
    this.dirty = true;

    if (validState(savedState)) {
      this.control.set(savedState.control);
      this.data.set(savedState.data);
      this.time = savedState.time;
      this.weekday = savedState.weekday;
      this.updatedAt = savedState.updatedAt;
      this.advance();
      this.dirty = false;
    }
  }

  get controlWord() { return (this.control[0] << 8) | this.control[1]; }
  get status() { return this.controlWord & kControlStop ? kStatusStopped : 0; }

  advance() {
    const now = this.now();
    if (!this.status) {
      const previousDay = Math.floor(this.time / kMillisecondsPerDay);
      // A backwards host-clock adjustment must not run the RTC backwards.
      this.time += Math.max(0, now - this.updatedAt);
      const days = Math.floor(this.time / kMillisecondsPerDay) - previousDay;
      this.weekday = (this.weekday + days) % 7;
    }
    this.updatedAt = now;
  }

  read(block) {
    switch (block) {
      case 0: return this.control.slice();
      case 1: return this.data.slice();
      case 2: {
        this.advance();
        const date = new Date(this.time);
        const year = date.getUTCFullYear() - 1900;
        return Uint8Array.of(
          toBCD(date.getUTCSeconds()), toBCD(date.getUTCMinutes()),
          0x80 | toBCD(date.getUTCHours()), toBCD(date.getUTCDate()),
          this.weekday, toBCD(date.getUTCMonth() + 1),
          toBCD(year % 100), toBCD(Math.floor(year / 100)));
      }
    }
    return null;
  }

  write(block, bytes) {
    if (block < 0 || block > 2 || bytes.length !== kBlockSize) {
      return false;
    }
    // Protected writes are acknowledged without changing the registers.
    if ((block === 1 && (this.controlWord & kProtectBlock1)) ||
        (block === 2 && (this.controlWord & kProtectBlock2))) {
      return true;
    }
    const time = block === 2 ? decodeTime(bytes) : null;
    if (block === 2 && time === null) {
      return false;
    }

    this.advance();
    switch (block) {
      case 0: this.control.set(bytes); break;
      case 1: this.data.set(bytes); break;
      case 2:
        this.time = time;
        // The weekday is independently programmable, just like the chip.
        this.weekday = bytes[4];
        break;
    }
    this.dirty = true;
    return true;
  }

  save() {
    this.advance();
    // Keeping a host timestamp lets a running clock advance while unloaded,
    // without writing local storage every time the RTC ticks.
    return {
      version: 1,
      control: Array.from(this.control),
      data: Array.from(this.data),
      time: this.time,
      weekday: this.weekday,
      updatedAt: this.updatedAt,
    };
  }
}

function toBCD(value) {
  return (Math.floor(value / 10) << 4) | (value % 10);
}

function fromBCD(value) {
  return (value & 15) <= 9 && (value >>> 4) <= 9 ? (value >>> 4) * 10 + (value & 15) : NaN;
}

function decodeTime(bytes) {
  const second = fromBCD(bytes[0]);
  const minute = fromBCD(bytes[1]);
  const hour = fromBCD(bytes[2] & 0x7f);
  const day = fromBCD(bytes[3]);
  const month = fromBCD(bytes[5]) - 1;
  const year = 1900 + fromBCD(bytes[6]) + 100 * fromBCD(bytes[7]);
  const time = Date.UTC(year, month, day, hour, minute, second);
  const date = new Date(time);
  // Reject invalid BCD/calendar values instead of normalizing them into a
  // different date or letting NaN poison later reads and persisted state.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second || bytes[4] > 6) {
    return null;
  }
  return time;
}

function validState(state) {
  const isBlock = block => Array.isArray(block) && block.length === kBlockSize &&
    block.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  return state?.version === 1 && isBlock(state.control) && isBlock(state.data) &&
    Number.isFinite(state.time) && Number.isFinite(new Date(state.time).getTime()) &&
    Number.isFinite(state.updatedAt) && Number.isInteger(state.weekday) &&
    state.weekday >= 0 && state.weekday <= 6;
}
