import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as eventQueue from "./event_queue.js";

const testEvent1 = 'testEvent1';
const testEvent2 = 'testEvent2';
const testEvent3 = 'testEvent3';

describe('event_queue', () => {
  let eq;
  beforeEach(() => {
    eq = new eventQueue.EventQueue();
  });
  afterEach(() => {
    mock.restore();
  });

  describe('lifeCycle', () => {
    test('should call the handler', () => {
      let handlerCalled = false;
      eq.addEvent(testEvent1, 100, () => { handlerCalled = true; });
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(100);

      eq.incrementCount(50);
      expect(handlerCalled).toBe(false);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(50);

      eq.incrementCount(49);
      expect(handlerCalled).toBe(false);
      expect(eq.hasEvent(testEvent1)).toBe(true);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(1);

      eq.incrementCount(1);
      expect(handlerCalled).toBe(true);
      expect(eq.hasEvent(testEvent1)).toBe(false);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(-1);
    });
    test('should allow multiple events to be queued', () => {
      let handler1Called = false;
      let handler2Called = false;
      let handler3Called = false;
      eq.addEvent(testEvent2, 100, () => { handler2Called = true; });
      eq.addEvent(testEvent1, 50, () => { handler1Called = true; });
      eq.addEvent(testEvent3, 150, () => { handler3Called = true; });
      expect(eq.hasEvent(testEvent1)).toBe(true);
      expect(eq.hasEvent(testEvent2)).toBe(true);
      expect(eq.hasEvent(testEvent3)).toBe(true);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(50);
      expect(eq.getCyclesUntilEvent(testEvent2)).toBe(100);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(150);

      eq.incrementCount(25);
      expect(handler1Called).toBe(false);
      expect(handler2Called).toBe(false);
      expect(handler3Called).toBe(false);
      expect(eq.hasEvent(testEvent1)).toBe(true);
      expect(eq.hasEvent(testEvent2)).toBe(true);
      expect(eq.hasEvent(testEvent3)).toBe(true);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(25);
      expect(eq.getCyclesUntilEvent(testEvent2)).toBe(75);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(125);

      eq.incrementCount(25);
      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(false);
      expect(handler3Called).toBe(false);
      expect(eq.hasEvent(testEvent1)).toBe(false);
      expect(eq.hasEvent(testEvent2)).toBe(true);
      expect(eq.hasEvent(testEvent3)).toBe(true);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(-1);
      expect(eq.getCyclesUntilEvent(testEvent2)).toBe(50);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(100);

      eq.incrementCount(50);
      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
      expect(handler3Called).toBe(false);
      expect(eq.hasEvent(testEvent1)).toBe(false);
      expect(eq.hasEvent(testEvent2)).toBe(false);
      expect(eq.hasEvent(testEvent3)).toBe(true);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(-1);
      expect(eq.getCyclesUntilEvent(testEvent2)).toBe(-1);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(50);

      eq.incrementCount(50);
      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
      expect(handler3Called).toBe(true);
      expect(eq.hasEvent(testEvent1)).toBe(false);
      expect(eq.hasEvent(testEvent2)).toBe(false);
      expect(eq.hasEvent(testEvent3)).toBe(false);
      expect(eq.getCyclesUntilEvent(testEvent1)).toBe(-1);
      expect(eq.getCyclesUntilEvent(testEvent2)).toBe(-1);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(-1);
    });

    test('only invokes fireEvents when countdown reaches zero or below', () => {
      let called = 0;
      const fireSpy = spyOn(eq, 'fireEvents');
      eq.addEvent(testEvent1, 10, () => { called++; });

      eq.incrementCount(9);
      expect(fireSpy).not.toHaveBeenCalled();
      expect(called).toBe(0);
      expect(eq.cyclesToFirstEvent).toBe(1);

      eq.incrementCount(1);
      expect(fireSpy).toHaveBeenCalledTimes(1);
      expect(called).toBe(1);
      expect(eq.hasEvent(testEvent1)).toBe(false);
    });

    test('fires simultaneous events and events added by handlers in order with accurate countdowns', () => {
      const fired = [];
      eq.addEvent(testEvent1, 50, () => {
        fired.push([testEvent1, eq.cyclesToFirstEvent]);
        eq.addEvent('nested', 30, () => {
          fired.push(['nested', eq.cyclesToFirstEvent]);
        });
      });
      eq.addEvent(testEvent2, 50, () => {
        fired.push([testEvent2, eq.cyclesToFirstEvent]);
      });
      eq.addEvent(testEvent3, 120, () => {
        fired.push([testEvent3, eq.cyclesToFirstEvent]);
      });

      eq.incrementCount(60);
      expect(fired).toEqual([
        [testEvent2, -10],
        [testEvent1, 60],
      ]);
      expect(eq.getCyclesUntilEvent('nested')).toBe(30);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(60);

      eq.incrementCount(30);
      expect(fired).toEqual([
        [testEvent2, -10],
        [testEvent1, 60],
        ['nested', 30],
      ]);
      expect(eq.getCyclesUntilEvent(testEvent3)).toBe(30);

      eq.incrementCount(30);
      expect(fired).toEqual([
        [testEvent2, -10],
        [testEvent1, 60],
        ['nested', 30],
        [testEvent3, 0],
      ]);
      expect(eq.firstEvent).toBeNull();
    });

    test('incrementCount and fireEvents on an empty queue are safe no-ops', () => {
      eq.incrementCount(100);
      eq.fireEvents();
      expect(eq.firstEvent).toBeNull();

      let called = false;
      eq.addEvent(testEvent1, 25, () => { called = true; });
      expect(eq.cyclesToFirstEvent).toBe(25);
      eq.incrementCount(25);
      expect(called).toBe(true);
    });
  });
});
