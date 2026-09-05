import { describe, expect, test } from 'bun:test';
import { Breakpoints } from './breakpoints.js';

const breakpointInstruction = 28 << 26;

function createFixture(initialInstruction) {
  const memory = new Map([[0x80001000, initialInstruction]]);
  const invalidated = [];
  const hardware = {
    memMap: {
      readMemoryInternal32: address => memory.get(address) ?? 0,
      writeMemoryInternal32: (address, instruction) => memory.set(address, instruction),
    },
  };
  const breakpoints = new Breakpoints(hardware, address => invalidated.push(address));
  return { breakpoints, invalidated, memory };
}

describe('Breakpoints', () => {
  test('does not mistake a real reserved instruction for a breakpoint', () => {
    const { breakpoints } = createFixture(breakpointInstruction);

    expect(breakpoints.isBreakpoint(0x80001000)).toBe(false);
    expect(breakpoints.getInstruction(0x80001000)).toBe(breakpointInstruction);
  });

  test('tracks installed breakpoints by address and restores the instruction', () => {
    const { breakpoints, invalidated, memory } = createFixture(0x012a4020);

    breakpoints.toggle(0x80001000);
    expect(breakpoints.isBreakpoint(0x80001000)).toBe(true);
    expect(breakpoints.getInstruction(0x80001000)).toBe(0x012a4020);
    expect(memory.get(0x80001000)).toBe(breakpointInstruction);

    breakpoints.toggle(0x80001000);
    expect(breakpoints.isBreakpoint(0x80001000)).toBe(false);
    expect(memory.get(0x80001000)).toBe(0x012a4020);
    expect(invalidated).toEqual([0x80001000, 0x80001000]);
  });

  test('restores an original zero instruction', () => {
    const { breakpoints, memory } = createFixture(0);

    breakpoints.toggle(0x80001000);
    breakpoints.toggle(0x80001000);

    expect(memory.get(0x80001000)).toBe(0);
  });
});
