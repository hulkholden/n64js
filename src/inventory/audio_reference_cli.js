#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { audioReferenceManifest } from './audio_reference_manifest.js';
import { auditAudioReferences } from './audio_reference_audit.js';
import { captureDirectories } from './audio_microcode_replay.js';
import { emulatorVersion } from './inventory_runner.js';
import { sourceHash } from './inventory_source.js';

const usage = `Usage: bun run audio-microcode-reference <corpus-or-run>... [options]
  --output <path>  Write JSON to a new file (default: stdout)
  --check          Require unambiguous results, no family disagreements and all
                  reviewed examples present with their expected identities
  --help          Show this help

Offline only: classifies raw task-start bytes against reviewed code/constants.
Unreviewed programs remain unknown. Instruction DMA evidence and ROM/image IDs
are never classifier inputs. Every published capture prefix is validated.
Original captures are not modified. A known identity is not HLE certification.
Exit codes: 0 audited; 1 --check failed; 2 invalid arguments or capture data.
`;

try {
  const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true,
    options: { output: { type: 'string' }, check: { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) console.log(usage);
  else {
    if (!positionals.length) throw new Error('Expected corpus or run directories');
    const started = performance.now();
    const directories = (await Promise.all(positionals.map(captureDirectories))).flat();
    const audit = await auditAudioReferences(directories);
    const analysis = { schemaVersion: 1,
      analyzer: { ...emulatorVersion(), sourceSha256: await sourceHash() },
      manifest: audioReferenceManifest,
      manifestSha256: createHash('sha256').update(JSON.stringify(audioReferenceManifest)).digest('hex'),
      elapsedMs: performance.now() - started, ...audit,
    };
    const json = JSON.stringify(analysis, null, 2) + '\n';
    if (values.output !== undefined) await writeFile(values.output, json, { flag: 'wx' });
    else process.stdout.write(json);
    const s = audit.summary;
    process.exitCode = values.check && (s.ambiguousTasks || s.familyDisagreements || s.missingExamples || s.mismatchedExamples) ? 1 : 0;
  }
} catch (error) {
  console.error(`${error?.message ?? error}\n${usage}`);
  process.exitCode = 2;
}
