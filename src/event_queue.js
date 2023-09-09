import { assert } from './assert.js';

export class EventQueue {
  constructor() {
    this.events = [];
  }

  reset() {
    this.events = [];
  }

  incrementCount(count) {
    const evt = this.events[0];
    evt.countdown -= count;
    if (evt.countdown <= 0) {
      this.onEventCountdownReached();
    }
  }

  skipToNextEvent(remain) {
    if (this.events.length == 0 || this.events[0].countdown < remain) {
      return 0;
    }
    const toSkip = this.events[0].countdown - remain;
    this.events[0].countdown = remain;
    return toSkip;
  }

  addEvent(type, countdown, handler) {
    assert(!this.hasEvent(type), `Already has event of type ${type}`);
    assert(countdown > 0, `Countdown must be positive`);

    // Insert the event into the list. 
    // Update the countdown to reflect the number of cycles relative to the previous event.
    for (let [i, event] of this.events.entries()) {
      if (countdown <= event.countdown) {
        event.countdown -= countdown;
        this.events.splice(i, 0, new SystemEvent(type, countdown, handler));
        return;
      }
      countdown -= event.countdown;
    }
    this.events.push(new SystemEvent(type, countdown, handler));
  }

  removeEventsOfType(type) {
    let count = 0;
    for (let [i, event] of this.events.entries()) {
      count += event.countdown;
      if (event.type == type) {
        // Add this countdown on to the subsequent event
        if ((i + 1) < this.events.length) {
          this.events[i + 1].countdown += event.countdown;
        }
        this.events.splice(i, 1);
        return count;
      }
    }

    // Not found.
    return -1;
  }

  getEvent(type) {
    for (let event of this.events) {
      if (event.type == type) {
        return event;
      }
    }
    return null;
  }

  /**
   * Returns the number of cycles to the provided event, or <0 if not found.
   * @param {string} type 
   * @returns {number}
   */
  getCyclesUntilEvent(type) {
    let countdown = 0;
    for (let event of this.events) {
      countdown += event.countdown;
      if (event.type == type) {
        return countdown;
      }
    }
    return -1;
  }

  hasEvent(type) {
    return Boolean(this.getEvent(type));
  }

  onEventCountdownReached() {
    while (this.events.length > 0 && this.events[0].countdown <= 0) {
      const evt = this.events[0];
      this.events.splice(0, 1);
      evt.handler();
    }
  }
}

class SystemEvent {
  constructor(type, countdown, handler) {
    this.type = type;
    this.countdown = countdown;
    this.handler = handler;
  }

  getName() { return this.type; }
}
