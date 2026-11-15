import { describe, expect, test } from 'bun:test';
import { captureFailure } from './inventory_failure.js';

describe('inventory failure evidence', () => {
  test('serializes non-Error throws without inventing a stack or leaking error properties', () => {
    for (const thrown of ['Read is out of range', null, undefined]) {
      expect(JSON.parse(JSON.stringify(captureFailure('exception', thrown))).exception).toEqual({
        name: null, message: String(thrown), stack: null,
      });
    }
    const error = new RangeError('outside buffer');
    error.circular = error;
    expect(JSON.parse(JSON.stringify(captureFailure('exception', error))).exception).toEqual({
      name: 'RangeError', message: error.message, stack: error.stack,
    });
  });

  test('captures halt context without an exception object and normalizes signed CPU PCs', () => {
    const emulator = {
      cpu0: { pc: -0x7ffff000, nextPC: -0x7fffeffc, delayPC: -0x7ffff004 },
      hardware: { rsp: { pc: 0x40, halted: false } },
    };
    const failure = captureFailure('halt', undefined, emulator);
    expect(failure).toEqual({
      version: 1,
      kind: 'halt',
      context: {
        cpu: { pc: 0x80001000, nextPC: 0x80001004, delayPC: 0x80000ffc },
        rsp: { pc: 0x40, halted: false },
      },
    });
    expect(failure.exception).toBeUndefined();
  });
});
