import { expect, test } from 'bun:test';
import { parseArgs, rewriteTestlist } from './build.js';

const requiredArgs = ['source', 'output', '--revision', 'abc123'];

test('build arguments default to all groups and accept explicit categories/features', () => {
  expect(parseArgs(requiredArgs)).toMatchObject({
    revision: 'abc123', categories: ['main', 'tlb', 'tlb64'], features: 'base',
  });
  expect(parseArgs([...requiredArgs, '--categories', 'main,tlb', '--features', 'base,timing']))
    .toMatchObject({ categories: ['main', 'tlb'], features: 'base,timing' });
});

test('build arguments support standard equals syntax and help', () => {
  expect(parseArgs(['source', 'output', '--revision=abc123', '--categories=tlb,tlb64']))
    .toMatchObject({ revision: 'abc123', categories: ['tlb', 'tlb64'] });
  expect(parseArgs(['--help'])).toBeNull();
  expect(parseArgs(['-h'])).toBeNull();
});

test('invalid build selections fail before touching the checkout', () => {
  expect(() => parseArgs(['source', 'output'])).toThrow('Usage:');
  expect(() => parseArgs([...requiredArgs, '--categories'])).toThrow('--categories');
  expect(() => parseArgs([...requiredArgs, '--categories', ''])).toThrow('--categories');
  expect(() => parseArgs([...requiredArgs, '--unknown'])).toThrow();
  expect(() => parseArgs([...requiredArgs, '--categories', 'typo'])).toThrow('--categories');
  expect(() => parseArgs([...requiredArgs, '--features', 'ci-main'])).toThrow('upstream');
  expect(() => parseArgs([...requiredArgs, '--features'])).toThrow('--features');
});

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
