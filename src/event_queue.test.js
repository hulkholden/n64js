import * as eventQueue from "./event_queue.js";

const assert = require('chai').assert;

const testEvent1 = 'testEvent1';
const testEvent2 = 'testEvent2';
const testEvent3 = 'testEvent3';

describe('event_queue', () => {
  let eq;
  beforeEach(() => {
    eq = new eventQueue.EventQueue();
  });

  describe('lifeCycle', () => {
    it('should call the handler', () => {
      let handlerCalled = false;
      eq.addEvent(testEvent1, 100, () => { handlerCalled = true; });
      assert.equal(100, eq.getCyclesUntilEvent(testEvent1));

      eq.incrementCount(50);
      assert.isFalse(handlerCalled);
      assert.equal(50, eq.getCyclesUntilEvent(testEvent1));

      eq.incrementCount(49);
      assert.isFalse(handlerCalled);
      assert.isTrue(eq.hasEvent(testEvent1));
      assert.equal(1, eq.getCyclesUntilEvent(testEvent1));

      eq.incrementCount(1);
      assert.isTrue(handlerCalled);
      assert.isFalse(eq.hasEvent(testEvent1));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent1));
    });
    it('should allow multiple events to be queued', () => {
      let handler1Called = false;
      let handler2Called = false;
      let handler3Called = false;
      eq.addEvent(testEvent2, 100, () => { handler2Called = true; });
      eq.addEvent(testEvent1, 50, () => { handler1Called = true; });
      eq.addEvent(testEvent3, 150, () => { handler3Called = true; });
      assert.isTrue(eq.hasEvent(testEvent1));
      assert.isTrue(eq.hasEvent(testEvent2));
      assert.isTrue(eq.hasEvent(testEvent3));
      assert.equal(50, eq.getCyclesUntilEvent(testEvent1));
      assert.equal(100, eq.getCyclesUntilEvent(testEvent2));
      assert.equal(150, eq.getCyclesUntilEvent(testEvent3));

      eq.incrementCount(25);
      assert.isFalse(handler1Called);
      assert.isFalse(handler2Called);
      assert.isFalse(handler3Called);
      assert.isTrue(eq.hasEvent(testEvent1));
      assert.isTrue(eq.hasEvent(testEvent2));
      assert.isTrue(eq.hasEvent(testEvent3));
      assert.equal(25, eq.getCyclesUntilEvent(testEvent1));
      assert.equal(75, eq.getCyclesUntilEvent(testEvent2));
      assert.equal(125, eq.getCyclesUntilEvent(testEvent3));

      eq.incrementCount(25);
      assert.isTrue(handler1Called);
      assert.isFalse(handler2Called);
      assert.isFalse(handler3Called);
      assert.isFalse(eq.hasEvent(testEvent1));
      assert.isTrue(eq.hasEvent(testEvent2));
      assert.isTrue(eq.hasEvent(testEvent3));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent1));
      assert.equal(50, eq.getCyclesUntilEvent(testEvent2));
      assert.equal(100, eq.getCyclesUntilEvent(testEvent3));

      eq.incrementCount(50);
      assert.isTrue(handler1Called);
      assert.isTrue(handler2Called);
      assert.isFalse(handler3Called);
      assert.isFalse(eq.hasEvent(testEvent1));
      assert.isFalse(eq.hasEvent(testEvent2));
      assert.isTrue(eq.hasEvent(testEvent3));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent1));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent2));
      assert.equal(50, eq.getCyclesUntilEvent(testEvent3));

      eq.incrementCount(50);
      assert.isTrue(handler1Called);
      assert.isTrue(handler2Called);
      assert.isTrue(handler3Called);
      assert.isFalse(eq.hasEvent(testEvent1));
      assert.isFalse(eq.hasEvent(testEvent2));
      assert.isFalse(eq.hasEvent(testEvent3));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent1));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent2));
      assert.equal(-1, eq.getCyclesUntilEvent(testEvent3));
    });
  });
});
