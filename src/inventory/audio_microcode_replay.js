import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AudioMicrocodeCollector } from './audio_microcode_collector.js';
import { readAudioCaptureEvents, readCaptureReport } from './audio_microcode_capture.js';
import { AudioInstructionObservations } from './audio_instruction_observations.js';
import { createAudioMicrocodeClassifier } from '../hle/audio_microcode_classifier.js';

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
  const recorded = report.collectors['audio.taskMicrocodes'];
  // Version 1 predates reviewed identities. Preserve its structural comparison;
  // never invent historical classifications or feed saved labels into replay.
  const classifications = recorded?.version === 2;
  const collector = new AudioMicrocodeCollector({ classifications });
  const classify = classifications ? createAudioMicrocodeClassifier() : null;
  const instructions = report.audioCapture.version === 2 ? new AudioInstructionObservations() : null;
  for await (const event of readAudioCaptureEvents(directory, report.audioCapture)) {
    instructions?.observe(event);
    if (event.type === 'task') collector.observe(event.image, classify?.(event.image.raw));
  }
  const audioMicrocodes = collector.snapshot();
  return {
    directory, reportSha256,
    source: { rom: report.rom, emulator: report.emulator, sourceSha256: report.sourceSha256, settings: report.settings, result: report.result },
    capture: report.audioCapture,
    // Missing live observations (e.g. ROM load failed) are not an empty collector.
    matchesRecorded: recorded === undefined ? null : isDeepStrictEqual(audioMicrocodes, recorded),
    audioMicrocodes,
    // Null means old capture/no observation capability, not zero code loads.
    instructionLoads: instructions?.snapshot() ?? null,
  };
}
