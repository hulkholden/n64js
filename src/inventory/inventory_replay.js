import { readFile } from 'node:fs/promises';
import { restoreInventorySettings } from './inventory_runner.js';
import { REPORT_SCHEMA_VERSION, isSha256, sha256Hex, validateReport } from './inventory_schema.js';

export async function loadReplayReport(path) {
  // Hash and parse one read so the provenance identifies the settings we used.
  const bytes = await readFile(path);
  const report = JSON.parse(bytes.toString('utf8'));
  if (report?.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error('Replay requires a version 1 inventory report');
  }
  validateReport(report);
  if (!isSha256(report.rom?.sha256)) {
    throw new Error('Replay requires a report with a ROM SHA-256');
  }
  return {
    settings: restoreInventorySettings(report.settings),
    replayOf: {
      reportSha256: sha256Hex(bytes),
      romSha256: report.rom.sha256,
      emulator: report.emulator,
    },
  };
}
