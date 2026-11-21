import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const REPORT_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const TERMINAL_STATUSES = new Set(['completed', 'cycle-limit', 'timeout', 'halted', 'error']);
export const REPORT_EXIT_CODES = {
  completed: 0,
  'cycle-limit': 3,
  timeout: 124,
  halted: 2,
  error: 2,
};

const EMULATOR_IDENTITY_KEYS = ['revision', 'runtime', 'runtimeVersion'];

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function ignoreMissing(error) {
  if (error?.code !== 'ENOENT') {
    throw error;
  }
}

export function sameEmulator(left, right) {
  // The source hash covers dirty emulator edits. Unrelated worktree changes
  // (including generated reports) may change the dirty flag without changing code.
  return EMULATOR_IDENTITY_KEYS.every(key => left?.[key] === right?.[key]);
}

export function entryReportName(sha256, index) {
  return `${sha256 ?? `error-${index}`}.json`;
}

function hasValidManifestHeader(manifest) {
  return isPlainObject(manifest) &&
    manifest.schemaVersion === MANIFEST_SCHEMA_VERSION &&
    Array.isArray(manifest.entries) &&
    isPlainObject(manifest.settings) &&
    isPlainObject(manifest.emulator);
}

function isValidManifestEntry(entry, index) {
  if (!isPlainObject(entry) || typeof entry.path !== 'string' || !isAbsolute(entry.path)) {
    return false;
  }
  if (entry.sha256 !== null && !isSha256(entry.sha256)) {
    return false;
  }
  if (entry.report !== null && entry.report !== entryReportName(entry.sha256, index)) {
    return false;
  }
  return true;
}

export function validateManifest(manifest) {
  if (!hasValidManifestHeader(manifest)) {
    throw new Error('Invalid or unsupported scan manifest');
  }
  for (const [index, entry] of manifest.entries.entries()) {
    if (!isValidManifestEntry(entry, index)) {
      throw new Error('Invalid ROM entry in scan manifest');
    }
  }
}

function isValidRomMetadata(rom) {
  if (rom === null) {
    return true;
  }
  return isPlainObject(rom) && typeof rom.name === 'string' && isSha256(rom.sha256);
}

function hasValidReportStructure(report) {
  return isPlainObject(report) &&
    isPlainObject(report.collectors) &&
    isPlainObject(report.result) &&
    isPlainObject(report.settings) &&
    isPlainObject(report.emulator) &&
    typeof report.result.status === 'string' &&
    typeof report.result.checkpointOnly === 'boolean' &&
    isValidRomMetadata(report.rom);
}

function matchesManifest(report, manifest, expectedSha256) {
  if (!isDeepStrictEqual(report.settings, manifest.settings)) {
    return false;
  }
  if (!sameEmulator(report.emulator, manifest.emulator)) {
    return false;
  }
  if (report.rom?.sha256 && report.rom.sha256 !== expectedSha256) {
    return false;
  }
  return true;
}

export function validateReport(report, source = {}) {
  if (!hasValidReportStructure(report)) {
    throw new Error('Invalid inventory report');
  }
  if (source.manifest && !matchesManifest(report, source.manifest, source.sha256)) {
    throw new Error('Report does not match its scan manifest');
  }
}
