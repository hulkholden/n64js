import { expect, test } from 'bun:test';
import { rewriteTestlist } from './build.js';

test('registry rewrite fails closed when upstream boundaries or registrations change', () => {
  expect(() => rewriteTestlist('')).toThrow('boundaries');
  const registry = `fn default_tests() {
    Box::new(super::startup::StartupTest {}),
    Box::new(super::arithmetic::Add {}),
    Box::new(super::tlb::Mapped {}),
    Box::new(super::tlb64::Load {}),
}
#[cfg(not(feature = "quick"))]`;
  const { testlist, counts } = rewriteTestlist(registry);
  expect(counts).toEqual({ main: 1, tlb: 1, tlb64: 1 });
  expect(testlist).toContain('fn default_tests() {\n    Box::new(super::startup::StartupTest {}),');
  expect(testlist).toContain('#[cfg(not(any(feature = "ci-main", feature = "ci-tlb64")))]\n        Box::new(super::tlb::Mapped');
  expect(() => rewriteTestlist(registry.replace('super::tlb::Mapped', 'other::Mapped')))
    .toThrow('registry layout');
});
