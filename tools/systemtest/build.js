#!/usr/bin/env bun
// Build isolated ROMs without changing test bodies or upstream's default selection.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const categories = ['main', 'tlb', 'tlb64'];
const romPath = 'target/mips-nintendo64-none/release/n64-systemtest.z64';
const usage = 'Usage: bun tools/systemtest/build.js <source> <output> --revision <sha>\n' +
  '  [--categories main tlb tlb64] [--features base,timing]';

/**
 * @typedef {Object} BuildArgs
 * @property {string} source
 * @property {string} output
 * @property {string} revision
 * @property {string[]} categories
 * @property {string} features
 */

/** @param {string[]} argv @returns {BuildArgs} */
export function parseArgs(argv) {
  const positionals = [];
  const args = { revision: '', categories: [...categories], features: 'base' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--categories') {
      args.categories = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.categories.push(argv[++i]);
      }
      if (!args.categories.length || args.categories.some(value => !categories.includes(value))) {
        throw new Error(`--categories requires one or more of: ${categories.join(', ')}`);
      }
    } else if (arg === '--revision' || arg === '--features') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--revision') args.revision = value;
      else args.features = value;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 2 || !args.revision) throw new Error(usage);
  if (args.features.split(',').some(feature => !feature || feature.startsWith('ci-'))) {
    throw new Error('--features must contain upstream feature names only');
  }
  return { ...args, source: resolve(positionals[0]), output: resolve(positionals[1]) };
}

/** @param {string} source @param {string[]} args @returns {string} */
function gitOutput(source, args) {
  const result = Bun.spawnSync(['git', ...args], { cwd: source });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString();
}

/** @param {string} source @param {string} expected @returns {string} */
function validateRevision(source, expected) {
  const revision = gitOutput(source, ['rev-parse', 'HEAD']).trim();
  if (revision !== expected) {
    throw new Error(`Expected ROM revision ${expected}, got ${revision}`);
  }
  return revision;
}

/** Read pristine files so repeated builds do not accumulate modifications.
 * @param {string} source @param {string} path @returns {string}
 */
function readOriginal(source, path) {
  return gitOutput(source, ['show', `HEAD:${path}`]);
}

/** @param {string} cargo @returns {string} */
export function rewriteCargo(cargo) {
  const features = categories.map(category => `ci-${category} = []`).join('\n');
  return cargo.replace('[features]', `[features]\n${features}`);
}

/** Guard quick-test registrations by category, preserving setup/teardown.
 * @param {string} testlist
 * @returns {{testlist: string, counts: Record<string, number>}}
 */
export function rewriteTestlist(testlist) {
  const counts = Object.fromEntries(categories.map(category => [category, 0]));
  let changed = 0;

  /** @param {string} match @param {string} module @returns {string} */
  function guardRegistration(match, module) {
    changed++;
    if (module === 'startup') return match;

    const category = ['tlb', 'tlb64'].includes(module) ? module : 'main';
    counts[category]++;
    const otherFeatures = categories
      .filter(other => other !== category)
      .map(other => `feature = "ci-${other}"`)
      .join(', ');
    return `#[cfg(not(any(${otherFeatures})))]\n        ${match}`;
  }

  // Stress/extra RDP lists stay untouched and are not enabled by base.
  const start = testlist.indexOf('fn default_tests()');
  const end = testlist.indexOf('#[cfg(not(feature = "quick"))]');
  if (start < 0 || end <= start) throw new Error('Unexpected test registry boundaries');
  const block = testlist.slice(start, end);
  const registrations = [...block.matchAll(/Box::new\(/g)].length;
  const rewritten = block.replace(/Box::new\(\s*super::([a-z0-9_]+)::/g, guardRegistration);
  if (changed !== registrations || Object.values(counts).some(count => count === 0)) {
    throw new Error(`Unexpected test registry layout: ${changed}/${registrations}, ${JSON.stringify(counts)}`);
  }
  return { testlist: testlist.slice(0, start) + rewritten + testlist.slice(end), counts };
}

/** @param {string} source @returns {Promise<Record<string, number>>} */
async function prepareSource(source) {
  const cargo = rewriteCargo(readOriginal(source, 'Cargo.toml'));
  const { testlist, counts } = rewriteTestlist(readOriginal(source, 'src/tests/testlist.rs'));
  await Bun.write(resolve(source, 'Cargo.toml'), cargo);
  await Bun.write(resolve(source, 'src/tests/testlist.rs'), testlist);
  return counts;
}

/**
 * @param {string} source
 * @param {string} output
 * @param {string} category
 * @param {string} features
 * @returns {Promise<void>}
 */
async function buildRom(source, output, category, features) {
  const child = Bun.spawn([
    'cargo', 'run', '--release', '--locked', '--no-default-features',
    '--features', `${features},ci-${category}`,
  ], { cwd: source, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`ROM build for ${category} exited with code ${exitCode}`);
  await Bun.write(resolve(output, `${category}.z64`), Bun.file(resolve(source, romPath)));
}

/** @returns {Promise<void>} */
async function main() {
  const argv = Bun.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return;
  }
  const args = parseArgs(argv);
  const revision = validateRevision(args.source, args.revision);
  const counts = await prepareSource(args.source);
  await mkdir(args.output, { recursive: true });
  for (const category of args.categories) {
    await buildRom(args.source, args.output, category, args.features);
  }
  console.log(`Built categories at ${revision}: ${JSON.stringify(counts)} (plus startup/teardown per group)`);
}

if (import.meta.main) {
  await main();
}
