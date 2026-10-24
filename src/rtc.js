// Cartridge Joybus RTC, using the interface documented by libdragon's rtc.h
// and rtc.c. See RTC.md for sources, supported behavior and approximations.
const kStop = 0x0004;
const kProtectData = 0x0100;
const kProtectTime = 0x0200;

export class CartridgeRTC {
  // now returns host milliseconds, independently of emulated CPU speed.
  constructor(now = Date.now, saved = null) {
    this.now = now;
    this.control = new Uint8Array([3, 0, 0, 0, 0, 0, 0, 0]);
    this.data = new Uint8Array(8);
    this.hostMillis = now();
    // The hardware stores civil time without a timezone. Seed it from local
    // time once, then use UTC calendar arithmetic to avoid host DST jumps.
    this.clockMillis = this.hostMillis - new Date(this.hostMillis).getTimezoneOffset() * 60_000;
    this.weekdayOffset = 0;
    this.dirty = true;

    if (validState(saved, this.hostMillis)) {
      this.control.set(saved.control);
      this.data.set(saved.data);
      this.hostMillis = saved.hostMillis;
      this.clockMillis = saved.clockMillis;
      this.weekdayOffset = saved.weekdayOffset;
      this.dirty = false;
    }
  }

  get controlWord() { return (this.control[0] << 8) | this.control[1]; }
  get stopped() { return (this.controlWord & kStop) !== 0; }
  get status() { return this.stopped ? 0x80 : 0; }

  currentTime(hostMillis = this.now()) {
    return this.clockMillis + (this.stopped ? 0 : hostMillis - this.hostMillis);
  }

  readBlock(block) {
    switch (block) {
      case 0: return this.control.slice();
      case 1: return this.data.slice();
      case 2: {
        const date = new Date(this.currentTime());
        const year = date.getUTCFullYear() - 1900;
        return new Uint8Array([
          bcd(date.getUTCSeconds()), bcd(date.getUTCMinutes()),
          0x80 | bcd(date.getUTCHours()), bcd(date.getUTCDate()),
          (date.getUTCDay() + this.weekdayOffset) % 7,
          bcd(date.getUTCMonth() + 1), bcd(year % 100), bcd(Math.floor(year / 100)),
        ]);
      }
      default: return null;
    }
  }

  writeBlock(block, bytes) {
    if (bytes.length !== 8) {
      return false;
    }
    switch (block) {
      case 0: {
        const now = this.now();
        this.clockMillis = this.currentTime(now);
        this.hostMillis = now;
        this.control.set(bytes);
        break;
      }
      case 1:
        if (this.controlWord & kProtectData) {
          return true;
        }
        this.data.set(bytes);
        break;
      case 2: {
        // The documented programming sequence stops and unlocks the clock.
        // Protected or running writes leave the clock unchanged.
        if ((this.controlWord & kProtectTime) || !this.stopped) {
          return true;
        }
        const date = decodeTime(bytes);
        if (!date) {
          return false;
        }
        this.clockMillis = date.getTime();
        this.hostMillis = this.now();
        // Day-of-week is a separate counter, not recalculated on writes.
        this.weekdayOffset = (bytes[4] - date.getUTCDay() + 7) % 7;
        break;
      }
      default: return false;
    }
    this.dirty = true;
    return true;
  }

  serialize() {
    // Keep the original anchor: running clocks also advance while unloaded.
    return {
      version: 1,
      control: Array.from(this.control),
      data: Array.from(this.data),
      hostMillis: this.hostMillis,
      clockMillis: this.clockMillis,
      weekdayOffset: this.weekdayOffset,
    };
  }
}

function bcd(value) {
  return (Math.floor(value / 10) << 4) | (value % 10);
}

function decimal(value) {
  return (value & 15) <= 9 && (value >>> 4) <= 9 ? (value >>> 4) * 10 + (value & 15) : NaN;
}

function decodeTime(bytes) {
  // Only the documented 24-hour encoding (bit 7 set) is supported.
  if (!(bytes[2] & 0x80)) {
    return null;
  }
  const second = decimal(bytes[0]);
  const minute = decimal(bytes[1]);
  const hour = decimal(bytes[2] & 0x7f);
  const day = decimal(bytes[3]);
  const weekday = decimal(bytes[4]);
  const month = decimal(bytes[5]);
  const year = 1900 + decimal(bytes[6]) + 100 * decimal(bytes[7]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date normalizes invalid fields, so compare each one before accepting.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second ||
      !(weekday >= 0 && weekday <= 6)) {
    return null;
  }
  return date;
}

function validState(saved, now) {
  const isBlock = value => Array.isArray(value) && value.length === 8 &&
    value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  const valid = saved?.version === 1 && isBlock(saved.control) && isBlock(saved.data) &&
    Number.isSafeInteger(saved.hostMillis) &&
    Number.isSafeInteger(saved.clockMillis) &&
    saved.clockMillis >= Date.UTC(1900, 0, 1) && saved.clockMillis < Date.UTC(11900, 0, 1) &&
    Number.isInteger(saved.weekdayOffset) && saved.weekdayOffset >= 0 && saved.weekdayOffset < 7;
  if (!valid) {
    return false;
  }
  const current = saved.clockMillis + ((saved.control[1] & kStop) ? 0 : now - saved.hostMillis);
  return current >= Date.UTC(1900, 0, 1) && current < Date.UTC(11900, 0, 1);
}
