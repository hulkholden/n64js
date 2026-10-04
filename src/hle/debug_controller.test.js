import { afterEach, expect, test } from 'bun:test';
import { DebugController } from './debug_controller.js';

const saved = globalThis.n64js;
afterEach(() => { globalThis.n64js = saved; });

test('requests CPU execution to capture a list even when emulation was paused', () => {
  let starts = 0;
  let breaks = 0;
  globalThis.n64js = {
    startEmulation() { starts++; },
    breakEmulationForDisplayListDebug() { breaks++; },
  };
  const dc = new DebugController({}, () => {});
  dc.showUI = () => {};
  dc.hideUI = () => {};
  dc.toggle();
  expect(starts).toBe(1);
  expect(dc.requested).toBe(true);
  dc.onNewTask({});
  expect(breaks).toBe(1);
  expect(dc.running).toBe(true);
  expect(dc.requested).toBe(false);
  dc.toggle();
  expect(dc.running).toBe(false);
  expect(starts).toBe(2);
});

test('a second toggle cancels a pending capture', () => {
  globalThis.n64js = { startEmulation() {} };
  const dc = new DebugController({}, () => {});
  dc.showUI = () => {};
  dc.hideUI = () => {};
  dc.toggle();
  dc.toggle();
  expect(dc.requested).toBe(false);
  expect(dc.running).toBe(false);
});

test('reset releases a captured task and cancels replay', () => {
  const dc = new DebugController({}, () => {});
  dc.running = true;
  dc.lastTask = {};
  dc.bailAfter = 12;
  dc.reset();
  expect(dc.running).toBe(false);
  expect(dc.requested).toBe(false);
  expect(dc.lastTask).toBeUndefined();
  expect(dc.bailAfter).toBe(-1);
});
