import { expect, test } from 'bun:test';
import { Framebuffer } from './framebuffer.js';

function redPixels(count, bitDepth) {
  const ram = new DataView(new ArrayBuffer(count * bitDepth / 8));
  for (let i = 0; i < count; i++) {
    if (bitDepth === 32) {
      ram.setUint32(i * 4, (i + 1) << 24);
    } else {
      ram.setUint16(i * 2, (i + 1) << 11);
    }
  }
  return ram;
}

function redAt(buffer, x, y) {
  const offset = (buffer.height - 1 - y) * buffer.width + x;
  return buffer.bitDepth === 32 ? buffer.pixels[offset * 4] : buffer.pixels[offset] >>> 11;
}

for (const bitDepth of [16, 32]) {
  test(`${bitDepth}-bit native copies respect source pitch and produce bottom-up opaque pixels`, () => {
    const buffer = new Framebuffer(3, 2, bitDepth);
    buffer.readN64Pixels(redPixels(8, bitDepth), 0, { pitch: 4 });
    expect([0, 1, 2].map(x => redAt(buffer, x, 0))).toEqual([1, 2, 3]);
    expect([0, 1, 2].map(x => redAt(buffer, x, 1))).toEqual([5, 6, 7]);
    expect(bitDepth === 32 ? Array.from(buffer.pixels.subarray(0, 4)) : buffer.pixels[0]).toEqual(
      bitDepth === 32 ? [5, 0, 0, 255] : (5 << 11) | 1);
  });

  test(`${bitDepth}-bit sampled copies preserve borders and alternate fields in a larger buffer`, () => {
    const buffer = new Framebuffer(6, 5, bitDepth);
    const ram = redPixels(32, bitDepth);
    const source = { pitch: 8, x: 1.5, y: 0.5, stepX: 0.5, stepY: 1.5 };
    const rect = { x: 1, y: 1, width: 4, height: 3 };
    buffer.readN64Pixels(ram, 0, source, rect, 1);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 1))).toEqual([0, 0, 0, 0]);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 2))).toEqual([18, 19, 19, 20]);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 3))).toEqual([0, 0, 0, 0]);
    buffer.readN64Pixels(ram, 0, source, rect, 0);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 1))).toEqual([2, 3, 3, 4]);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 2))).toEqual([18, 19, 19, 20]);
    expect([1, 2, 3, 4].map(x => redAt(buffer, x, 3))).toEqual([26, 27, 27, 28]);
    for (let y = 0; y < 5; y++) {
      expect(redAt(buffer, 0, y)).toBe(0);
      expect(redAt(buffer, 5, y)).toBe(0);
    }
    expect([0, 1, 2, 3, 4, 5].map(x => redAt(buffer, x, 0))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([0, 1, 2, 3, 4, 5].map(x => redAt(buffer, x, 4))).toEqual([0, 0, 0, 0, 0, 0]);
  });
}
