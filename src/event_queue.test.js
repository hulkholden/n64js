import * as eq from "./event_queue.js";

const assert = require('chai').assert;

const testEvent1 = 'testEvent1';
const testEvent2 = 'testEvent2';
const testEvent3 = 'testEvent3';

describe('event_queue', () => {
  let eventQueue;
  beforeEach(() => {
    eventQueue = new eq.EventQueue();
  });

  describe('lifeCycle', () => {
    it('should call the handler', () => {
      let handlerCalled = false;
      eventQueue.addEvent(testEvent1, 100, () => { handlerCalled = true; });
      assert.equal(100, eventQueue.getCyclesUntilEvent(testEvent1));

      eventQueue.incrementCount(50);
      assert.isFalse(handlerCalled);
      assert.equal(50, eventQueue.getCyclesUntilEvent(testEvent1));

      eventQueue.incrementCount(49);
      assert.isFalse(handlerCalled);
      assert.isTrue(eventQueue.hasEvent(testEvent1));
      assert.equal(1, eventQueue.getCyclesUntilEvent(testEvent1));

      eventQueue.incrementCount(1);
      assert.isTrue(handlerCalled);
      assert.isFalse(eventQueue.hasEvent(testEvent1));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent1));
    });
    it('should allow multiple events to be queued', () => {
      let handler1Called = false;
      let handler2Called = false;
      let handler3Called = false;
      eventQueue.addEvent(testEvent2, 100, () => { handler2Called = true; });
      eventQueue.addEvent(testEvent1, 50, () => { handler1Called = true; });
      eventQueue.addEvent(testEvent3, 150, () => { handler3Called = true; });
      assert.isTrue(eventQueue.hasEvent(testEvent1));
      assert.isTrue(eventQueue.hasEvent(testEvent2));
      assert.isTrue(eventQueue.hasEvent(testEvent3));
      assert.equal(50, eventQueue.getCyclesUntilEvent(testEvent1));
      assert.equal(100, eventQueue.getCyclesUntilEvent(testEvent2));
      assert.equal(150, eventQueue.getCyclesUntilEvent(testEvent3));

      eventQueue.incrementCount(25);
      assert.isFalse(handler1Called);
      assert.isFalse(handler2Called);
      assert.isFalse(handler3Called);
      assert.isTrue(eventQueue.hasEvent(testEvent1));
      assert.isTrue(eventQueue.hasEvent(testEvent2));
      assert.isTrue(eventQueue.hasEvent(testEvent3));
      assert.equal(25, eventQueue.getCyclesUntilEvent(testEvent1));
      assert.equal(75, eventQueue.getCyclesUntilEvent(testEvent2));
      assert.equal(125, eventQueue.getCyclesUntilEvent(testEvent3));

      eventQueue.incrementCount(25);
      assert.isTrue(handler1Called);
      assert.isFalse(handler2Called);
      assert.isFalse(handler3Called);
      assert.isFalse(eventQueue.hasEvent(testEvent1));
      assert.isTrue(eventQueue.hasEvent(testEvent2));
      assert.isTrue(eventQueue.hasEvent(testEvent3));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent1));
      assert.equal(50, eventQueue.getCyclesUntilEvent(testEvent2));
      assert.equal(100, eventQueue.getCyclesUntilEvent(testEvent3));

      eventQueue.incrementCount(50);
      assert.isTrue(handler1Called);
      assert.isTrue(handler2Called);
      assert.isFalse(handler3Called);
      assert.isFalse(eventQueue.hasEvent(testEvent1));
      assert.isFalse(eventQueue.hasEvent(testEvent2));
      assert.isTrue(eventQueue.hasEvent(testEvent3));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent1));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent2));
      assert.equal(50, eventQueue.getCyclesUntilEvent(testEvent3));

      eventQueue.incrementCount(50);
      assert.isTrue(handler1Called);
      assert.isTrue(handler2Called);
      assert.isTrue(handler3Called);
      assert.isFalse(eventQueue.hasEvent(testEvent1));
      assert.isFalse(eventQueue.hasEvent(testEvent2));
      assert.isFalse(eventQueue.hasEvent(testEvent3));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent1));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent2));
      assert.equal(-1, eventQueue.getCyclesUntilEvent(testEvent3));
    });
  });
});
