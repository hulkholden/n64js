import { describe, expect, test } from 'bun:test';
import { Vector2 } from '../graphics/Vector2.js';
import { NativeTransform } from './native_transform.js';

describe('native framebuffer dimensions', () => {
  test('keeps usable dimensions while VI scanout is blanked during startup or a transition', () => {
    const transform = new NativeTransform();
    // Mario clears its three framebuffers with VI_H_START = 0. The VI
    // dimension calculation reports a negative width during that blanking.
    transform.initDimensions(-4, 474);
    expect(transform.viWidth).toBe(320);
    expect(transform.viHeight).toBe(240);
    transform.initDimensions(320, 237);
    for (const [width, height] of [[-4, 474], [0, 240], [320, 0], [NaN, 240], [320, Infinity]]) {
      transform.initDimensions(width, height);
      expect(transform.viWidth).toBe(320);
      expect(transform.viHeight).toBe(237);
      const corner = transform.convertN64ToDisplay(new Vector2(320, 237));
      expect(corner.x).toBeCloseTo(1, 6);
      expect(corner.y).toBeCloseTo(-1, 6);
      expect([...transform.viTransform.scale.elems]).toEqual([160, -118.5, 512, 1]);
    }
    transform.initDimensions(640, 480);
    expect(transform.viWidth).toBe(640);
    expect(transform.viHeight).toBe(480);
  });
});
