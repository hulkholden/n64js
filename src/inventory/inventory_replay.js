import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateReport } from './inventory_reports.js';
import { restoreInventorySettings } from './inventory_runner.js';

export async function loadReplayReport(path) {
  // Hash and parse one read so the provenance identifies the settings we used.
  const bytes = await readFile(path);
  const report = JSON.parse(bytes.toString('utf8'));
  if (report?.schemaVersion !== 1) throw new Error('Replay requires a version 1 inventory report');
  validateReport(report);
  if (typeof report.rom?.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(report.rom.sha256)) {
    throw new Error('Replay requires a report with a ROM SHA-256');
  }
  return {
    settings: restoreInventorySettings(report.settings),
    replayOf: {
      reportSha256: createHash('sha256').update(bytes).digest('hex'),
      romSha256: report.rom.sha256,
      emulator: report.emulator,
    },
  };
}
