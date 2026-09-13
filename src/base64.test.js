import { Buffer } from 'node:buffer';
import { describe, expect, test } from 'bun:test';
import { decodeArray, encodeArray } from './base64.js';

describe('base64 byte arrays', () => {
  test.each([
    [[], ''],
    [[0xff], '/w=='],
    [[0xff, 0xee], '/+4='],
    [[0xff, 0xee, 0xdd], '/+7d'],
  ])('encodes %j with standard base64 padding', (bytes, expected) => {
    expect(encodeArray(new Uint8Array(bytes))).toBe(expected);
    expect(decodeArray(expected)).toEqual(new Uint8Array(bytes));
  });

  // Include the 128 KiB FlashRAM size and a larger buffer that exceeds Bun's
  // argument limit too; Chromium overflows already at the FlashRAM size.
  test.each([256, 32 * 1024, 96 * 1024, 128 * 1024, 128 * 1024 + 1, 1024 * 1024])(
    'encodes and restores all bytes of a %i-byte view', size => {
      const backing = Uint8Array.from({ length: size + 32 }, (_, i) => (i * 17 + 3) & 0xff);
      const bytes = backing.subarray(13, 13 + size);
      const encoded = encodeArray(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString('base64'));
      expect(decodeArray(encoded)).toEqual(bytes);
    },
  );
});
