import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createMicrocodeHash } from './audio_microcode_hash.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

describe('bounded browser SHA-256', () => {
  test('matches native SHA-256 at every supported length, including padding and unaligned views', () => {
    const digest = createMicrocodeHash();
    expect(digest(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(digest(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const bytes = new Uint8Array(4100);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 73 + (i >>> 3)) & 255;
    }
    // Descending sizes catch residual scratch bytes from previous hashes.
    for (let n = 4096; n >= 0; n--) {
      expect(digest(bytes.subarray(3, n + 3))).toBe(hash(bytes.subarray(3, n + 3)));
    }
    expect(() => digest(new Uint8Array(4097))).toThrow();
    expect(() => digest([])).toThrow();
  });
});
