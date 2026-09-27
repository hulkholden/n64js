import { AudioMicrocodeCollector } from './audio_microcode_collector.js';
import { readAudioCapture, readCaptureReport } from './audio_microcode_capture.js';
import { classifyAudioReference } from './audio_reference.js';
import { audioReferenceExamples } from './audio_reference_examples.js';

/** Validate full published streams. The independent structural detector is a
 * diagnostic cross-tab, not the source of reference identities. Reviewed cases
 * are looked up only AFTER classification, so their ROM/image IDs cannot leak
 * into the classifier. Unknown coverage is expected for this partial manifest.
 */
export async function auditAudioReferences(directories, { classify = classifyAudioReference, examples = audioReferenceExamples } = {}) {
  const cases = examples.map(e => ({ ...e, observations: 0, mismatches: 0, reference: null }));
  const caseIndex = new Map();
  for (const example of cases) {
    const key = `${example.romSha256}:${example.imageId}`;
    if (!caseIndex.has(key)) caseIndex.set(key, []);
    caseIndex.get(key).push(example);
  }
  const runs = [];
  for (const directory of [...new Set(directories)].sort()) {
    const { report, reportSha256 } = await readCaptureReport(directory);
    const seen = new Map(), groups = new Map();
    for await (const task of readAudioCapture(directory, report.audioCapture)) {
      let group = seen.get(task.imageId);
      if (!group) {
        const result = classify(task.image.raw);
        const collector = new AudioMicrocodeCollector();
        collector.observe(task.image);
        const { family, fingerprint } = collector.snapshot().microcodes[0];
        const provisional = { family, fingerprint };
        const key = JSON.stringify([result, provisional]);
        if (!groups.has(key)) groups.set(key, {
          result, provisional, tasks: 0, images: 0,
          reference: { task: task.task, imageId: task.imageId },
        });
        group = groups.get(key);
        group.images++;
        seen.set(task.imageId, group);
      }
      group.tasks++;
      for (const example of caseIndex.get(`${report.rom?.sha256}:${task.imageId}`) ?? []) {
        example.observations++;
        const matches = example.identity === null ? group.result.status === 'unknown' :
          group.result.status === 'known' && group.result.identity === example.identity;
        if (!matches) example.mismatches++;
        example.reference ??= { directory, reportSha256, task: task.task, actual: group.result };
      }
    }
    runs.push({
      directory, reportSha256, capture: report.audioCapture,
      source: { rom: report.rom, emulator: report.emulator, sourceSha256: report.sourceSha256, settings: report.settings, result: report.result },
      groups: [...groups.values()],
    });
  }
  const groups = runs.flatMap(r => r.groups);
  const tasks = predicate => groups.filter(predicate).reduce((sum, g) => sum + g.tasks, 0);
  const reviewedCases = cases.map(e => ({ ...e, status: !e.observations ? 'missing' : e.mismatches ? 'mismatch' : 'matched' }));
  return {
    scope: 'offline-reference-classification',
    summary: {
      runs: runs.length, emptyRuns: runs.filter(r => !r.capture.tasks).length,
      partialRuns: runs.filter(r => r.source.result.checkpointOnly).length,
      tasks: tasks(() => true), images: groups.reduce((sum, g) => sum + g.images, 0),
      knownTasks: tasks(g => g.result.status === 'known'),
      unknownTasks: tasks(g => g.result.status === 'unknown'),
      ambiguousTasks: tasks(g => g.result.status === 'ambiguous'),
      // A family-level check only: agreement cannot verify a program identity.
      familyDisagreements: tasks(g => g.result.status === 'known' && g.result.family !== g.provisional.family),
      matchedExamples: reviewedCases.filter(e => e.status === 'matched').length,
      missingExamples: reviewedCases.filter(e => e.status === 'missing').length,
      mismatchedExamples: reviewedCases.filter(e => e.status === 'mismatch').length,
    },
    examples: reviewedCases, runs,
  };
}
