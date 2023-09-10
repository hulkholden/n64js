import { assert } from './assert.js';

export class EventQueue {
  constructor() {
    this.cyclesToFirstEvent = 0;
    this.firstEvent = null;
  }

  reset() {
    this.cyclesToFirstEvent = 0;
    this.firstEvent = null;
  }

  nextEventCountdown() {
    return this.cyclesToFirstEvent;
  }

  incrementCount(count) {
    this.cyclesToFirstEvent -= count;
    while (this.cyclesToFirstEvent <= 0) {
      const evt = this.firstEvent;
      if (!evt) {
        // TODO: add a check somewhere that there is >1 event.
        break;
      }
      this.unlink(evt);
      evt.handler();
    }
  }

  unlink(node) {
    if (node.prev) {
      node.prev.cyclesToNextEvent = node.next ? (node.prev.cyclesToNextEvent + node.cyclesToNextEvent) : 0;
      node.prev.next = node.next;
    } else {
      this.cyclesToFirstEvent = node.next ? (this.cyclesToFirstEvent + node.cyclesToNextEvent) : 0;
      this.firstEvent = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  insertAfter(prevNode, cyclesToNextEvent, newNode, cycles) {
    const nextNode = prevNode ? prevNode.next : this.firstEvent;
    newNode.cyclesToNextEvent = nextNode ? cyclesToNextEvent - cycles : 0;
    assert(newNode.cyclesToNextEvent >= 0, `cyclesToNextEvent must be positive or zero`);

    newNode.next = nextNode;
    newNode.prev = prevNode;
    if (nextNode) {
      nextNode.prev = newNode;
    }

    if (prevNode) {
      prevNode.cyclesToNextEvent = cycles;
      prevNode.next = newNode;
    } else {
      this.cyclesToFirstEvent = cycles;
      this.firstEvent = newNode;
    }
  }

  skipToNextEvent(remain) {
    if (!this.firstEvent || this.cyclesToFirstEvent < remain) {
      return 0;
    }
    const toSkip = this.cyclesToFirstEvent - remain;
    this.cyclesToFirstEvent = remain;
    return toSkip;
  }

  addEvent(type, cycles, handler) {
    assert(!this.hasEvent(type), `Already has event of type ${type}`);
    assert(cycles > 0, `cycles must be positive`);

    const newEvent = new SystemEvent(type, handler);

    // Update the cycles counters to reflect the number of cycles relative to the previous event.
    let lastEvent = null;
    let cyclesToEvent = this.cyclesToFirstEvent;
    for (let event = this.firstEvent; event; event = event.next) {
      if (cycles <= cyclesToEvent) {
        this.insertAfter(lastEvent, cyclesToEvent, newEvent, cycles);
        return;
      }
      cycles -= cyclesToEvent;
      cyclesToEvent = event.cyclesToNextEvent;
      lastEvent = event;
    }
    this.insertAfter(lastEvent, cyclesToEvent, newEvent, cycles);
  }

  /**
   * Removes the first event of the given type from the queue
   * @param {string} type 
   * @returns {number} The number of cycles to the event if found, else -1.
   */
  removeEvent(type) {
    let count = this.cyclesToFirstEvent;
    for (let event = this.firstEvent; event; event = event.next) {
      if (event.type == type) {
        this.unlink(event);
        return count;
      }
      count += event.cyclesToNextEvent;
    }

    // Not found.
    return -1;
  }

  getEvent(type) {
    for (let event = this.firstEvent; event; event = event.next) {
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
    let cycles = this.cyclesToFirstEvent;
    for (let event = this.firstEvent; event; event = event.next) {
      if (event.type == type) {
        return cycles;
      }
      cycles += event.cyclesToNextEvent;
    }
    return -1;
  }

  hasEvent(type) {
    return Boolean(this.getEvent(type));
  }
}

class SystemEvent {
  constructor(type, handler) {
    this.type = type;
    this.cyclesToNextEvent = 0;
    this.handler = handler;
    this.prev = null;
    this.next = null;
  }

  getName() { return this.type; }
}
