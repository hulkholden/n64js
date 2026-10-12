import { describe, expect, test } from 'bun:test';
import { Fragment, FragmentCache } from './fragments.js';

function fixture() {
  const cache = new FragmentCache();
  const source = new Fragment(0x80001000, cache);
  const original = cache.lookupFragment.bind(cache);
  let lookups = 0;
  cache.lookupFragment = pc => { lookups++; return original(pc); };
  const target = pc => {
    const f = new Fragment(pc, cache);
    f.opsCompiled = 11;
    f.func = () => 11;
    cache.fragments.set(pc, f);
    return f;
  };
  return { cache, source, target, lookups: () => lookups };
}

describe('hybrid successor cache', () => {
  test('self-loop reentry resets a partial trace, including a zero-op exit', () => {
    const { source, lookups } = fixture();
    source.opsCompiled = 11;
    source.func = () => 0;
    expect(source.getNextFragment(source.entryPC, 0)).toBe(source);
    source.func = undefined;
    expect(source.getNextFragment(source.entryPC, 0)).toBe(source);
    expect(source.opsCompiled).toBe(0);
    expect(source.generation).toBe(1);
    expect(lookups()).toBe(0);
  });

  test('alternating branch outcomes at the same count stay cached', () => {
    const { source, target, lookups } = fixture();
    const a = target(0x7f0b05ec), b = target(0x7f0b05f4);
    for (let i = 0; i < 100; i++) {
      const next = i & 1 ? a : b;
      expect(source.getNextFragment(next.entryPC, 11)).toBe(next);
    }
    expect(lookups()).toBe(2);
  });

  test('a cold target keeps warming without evicting a hot primary', () => {
    const { source, target, lookups, cache } = fixture();
    const hot = target(0x7f0b05ec), coldPC = 0x7f0b05f4;
    expect(source.getNextFragment(hot.entryPC, 11)).toBe(hot);
    for (let i = 0; i < 499; i++) {
      expect(source.getNextFragment(coldPC, 11)).toBeNull();
      expect(source.getNextFragment(hot.entryPC, 11)).toBe(hot);
    }
    const warmed = source.getNextFragment(coldPC, 11);
    expect(warmed).toBe(cache.fragments.get(coldPC));
    expect(warmed.entryPC).toBe(coldPC);
    expect(source.getNextFragment(hot.entryPC, 11)).toBe(hot);
    expect(lookups()).toBe(501);
  });

  test('colliding PC hashes never return the wrong fragment', () => {
    const { source, target } = fixture();
    const groups = new Map();
    let targets;
    // Inserting size + 1 distinct PCs must collide, independent of the hash.
    for (let i = 0; i <= source.successors.length; i++) {
      const fragment = target(0x80002000 + i * 4);
      source.getNextFragment(fragment.entryPC, 11);
      const slot = source.successors.indexOf(fragment);
      expect(slot).toBeGreaterThanOrEqual(0);
      if (groups.has(slot)) {
        targets = [groups.get(slot), fragment];
        break;
      }
      groups.set(slot, fragment);
    }
    expect(targets).toBeDefined();
    for (let i = 0; i < 100; i++) {
      const next = targets[i & 1];
      expect(source.getNextFragment(next.entryPC, 11)).toBe(next);
    }
  });

  test('an unfinished trace from the secondary cache is reset on reentry', () => {
    const { source, target, lookups } = fixture();
    const a = target(0x7f0b05ec), b = target(0x7f0b05f4);
    source.getNextFragment(a.entryPC, 11);
    source.getNextFragment(b.entryPC, 11);
    a.func = undefined;
    expect(source.getNextFragment(a.entryPC, 11)).toBe(a);
    expect(a.opsCompiled).toBe(0);
    expect(a.generation).toBe(1);
    expect(lookups()).toBe(2);
  });

  test('a pending compiled successor survives a secondary-cache hit without validation', () => {
    const { source, target, lookups } = fixture();
    const a = target(0x7f0b05ec), b = target(0x7f0b05f4), original = a.func;
    source.getNextFragment(a.entryPC, 11);
    source.getNextFragment(b.entryPC, 11);
    a.invalidate(true);
    expect(source.getNextFragment(a.entryPC, 11)).toBe(a);
    expect(a.func).toBeUndefined();
    expect(a.cachedFunc).toBe(original);
    expect(a.opsCompiled).toBe(11);
    expect(lookups()).toBe(2);
  });

  test('source code reuse retains caches; full invalidation discards them', () => {
    const { source, target, lookups } = fixture();
    const a = target(0x7f0b05ec), b = target(0x7f0b05f4);
    source.opsCompiled = 11;
    source.func = () => 11;
    source.getNextFragment(a.entryPC, 11);
    source.getNextFragment(b.entryPC, 11);
    source.invalidate(true);
    source.reuse();
    expect(source.getNextFragment(a.entryPC, 11)).toBe(a);
    expect(lookups()).toBe(2);
    source.invalidate();
    expect(source.getNextFragment(b.entryPC, 11)).toBe(b);
    expect(lookups()).toBe(3);
  });
});
