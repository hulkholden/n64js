import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { EmulationMode } from '../hle/emulation_mode.js';
import { inputPolicy, parseInputScript } from './input.js';
import { isPlainObject } from './schema.js';

const DEFAULT_SEED = '1';
const DEFAULT_FRAMES = '600';
const DEFAULT_MAX_CYCLES = '5000000000';
const DEFAULT_TIMEOUT_MS = '60000';
const MAX_UINT32 = 0xffffffff;
const MAX_TIMEOUT_MS = 0x7fffffff;

export const inventoryOptions = {
  seed: { type: 'string' },
  frames: { type: 'string' },
  'max-cycles': { type: 'string' },
  'timeout-ms': { type: 'string' },
  'input-script': { type: 'string' },
};

export async function loadInputScript(path) {
  if (path === undefined) {
    return undefined;
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

function parseIntegerOption(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return number;
}

function buildInputPolicy(script) {
  if (script === undefined) {
    return inputPolicy;
  }
  return {
    name: 'scripted-prefix',
    version: 1,
    script: parseInputScript(script),
    after: inputPolicy,
  };
}

export function inventorySettings(values, script) {
  return {
    seed: parseIntegerOption(values.seed ?? DEFAULT_SEED, 'seed', 0, MAX_UINT32),
    frames: parseIntegerOption(values.frames ?? DEFAULT_FRAMES, 'frames', 1),
    maxCycles: parseIntegerOption(values['max-cycles'] ?? DEFAULT_MAX_CYCLES, 'max-cycles', 1),
    timeoutMs: parseIntegerOption(values['timeout-ms'] ?? DEFAULT_TIMEOUT_MS, 'timeout-ms', 1, MAX_TIMEOUT_MS),
    randomAlgorithm: 'mulberry32',
    inputPolicy: buildInputPolicy(script),
    graphics: EmulationMode.HLE,
  };
}

// Reject settings this version cannot reproduce, including changed input policies.
export function restoreInventorySettings(settings) {
  if (!isPlainObject(settings)) {
    throw new Error('Invalid inventory settings');
  }
  const expected = inventorySettings({
    seed: String(settings.seed),
    frames: String(settings.frames),
    'max-cycles': String(settings.maxCycles),
    'timeout-ms': String(settings.timeoutMs),
  }, settings.inputPolicy?.script);
  if (!isDeepStrictEqual(settings, expected)) {
    throw new Error('Unsupported inventory settings or input policy');
  }
  return expected;
}
