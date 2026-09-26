import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AudioMicrocodeCollector } from './audio_microcode_collector.js';
import { readAudioCapture, readCaptureReport } from './audio_microcode_capture.js';

export async function captureDirectories(input) {
  const directory = resolve(input);
  if (await stat(join(directory, 'report.json')).catch(error => { if (error.code !== 'ENOENT') throw error; })) return [directory];
  const runs = join(directory, 'runs');
  const directories = (await readdir(runs, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => join(runs, entry.name)).sort();
  if (!directories.length) throw new Error(`No audio captures found: ${directory}`);
  return directories;
}

export async function replayAudioCapture(directory) {
  const { report, reportSha256 } = await readCaptureReport(directory);
  const collector = new AudioMicrocodeCollector();
  for await (const task of readAudioCapture(directory, report.audioCapture)) collector.observe(task.image);
  const audioMicrocodes = collector.snapshot();
  const recorded = report.collectors['audio.taskMicrocodes'];
  return {
    directory, reportSha256,
    source: { rom: report.rom, emulator: report.emulator, sourceSha256: report.sourceSha256, settings: report.settings, result: report.result },
    capture: report.audioCapture,
    // Missing live observations (e.g. ROM load failed) are not an empty collector.
    matchesRecorded: recorded === undefined ? null : isDeepStrictEqual(audioMicrocodes, recorded),
    audioMicrocodes,
  };
}
