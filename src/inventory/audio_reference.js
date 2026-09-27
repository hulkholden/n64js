import { createHash } from 'node:crypto';
import { audioReferenceManifest } from './audio_reference_manifest.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unknown = reason => ({ status: 'unknown', identity: null, family: 'Unknown', reason });
const ambiguous = (reason, candidates) => ({ ...unknown(reason), status: 'ambiguous', candidates: candidates.sort() });
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;

/** Compile an explicitly reviewed manifest. The factory also permits synthetic
 * manifests in tests, without committing captured game bytes. Every bootstrap
 * listed here must implement the same layout: task data -> DMEM 0, then 0xf80
 * code bytes -> IMEM 0x1080. New loading layouts need a separate review.
 */
export function createAudioReferenceClassifier(manifest) {
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const length = (value, limit) => Number.isInteger(value) && value > 0 && value <= limit && value % 4 === 0;
  const uniqueIDs = entries => entries.every(e => typeof e.id === 'string' && e.id.length) && new Set(entries.map(e => e.id)).size === entries.length;
  if (manifest?.version !== 1 || !Array.isArray(manifest.bootstraps) || !manifest.bootstraps.length ||
      !Array.isArray(manifest.programs) || !manifest.programs.length ||
      !uniqueIDs(manifest.bootstraps) || !uniqueIDs(manifest.programs) ||
      !manifest.bootstraps.every(b => length(b.bytes, 4096) && digest(b.sha256)) ||
      !manifest.programs.every(p => p.family === 'ABI1' && length(p.codeBytes, codeLoadBytes) &&
        length(p.dataBytes, taskOffset) && digest(p.codeSha256) && digest(p.dataSha256))) {
    throw new Error('Invalid audio reference manifest');
  }
  const bootstraps = manifest.bootstraps.map(b => ({ ...b }));
  const programs = manifest.programs.map(p => ({ ...p }));

  // The API deliberately receives only raw task-start bytes. No ROM name,
  // interpreted loader, provisional fingerprint or post-DMA state is consulted.
  return raw => {
    if (!raw || !['task', 'imem', 'code', 'data'].every(k => raw[k] instanceof Uint8Array) ||
        raw.task.length !== 64 || raw.imem.length !== 4096 || raw.code.length > 4096 || raw.data.length > 4096) {
      return unknown('invalid-snapshot');
    }
    const task = new DataView(raw.task.buffer, raw.task.byteOffset, raw.task.byteLength);
    if (task.getUint32(0) !== 2) return unknown('not-audio-task');
    const codeAddress = task.getUint32(0x10) & 0x1fffffff;
    const dataAddress = task.getUint32(0x18) & 0x1fffffff;
    const dataSize = task.getUint32(0x1c);
    // These bootstraps ignore ucode_size. They round the data DMA up to eight
    // bytes. Reject truncation, alignment changes and a data DMA that overwrites
    // the OSTask header before the subsequent code-pointer load.
    const loadedDataBytes = Math.ceil(dataSize / 8) * 8;
    if (!codeAddress || !dataAddress || (codeAddress & 7) || (dataAddress & 7) ||
        raw.code.length < codeLoadBytes || !dataSize || loadedDataBytes > taskOffset || raw.data.length < loadedDataBytes) {
      return unknown('unsupported-task-layout');
    }
    const bootHashes = new Map();
    const boots = bootstraps.filter(b => {
      if (!bootHashes.has(b.bytes)) bootHashes.set(b.bytes, hash(raw.imem.subarray(0, b.bytes)));
      return bootHashes.get(b.bytes) === b.sha256;
    });
    if (!boots.length) return unknown('unreviewed-bootstrap');
    if (boots.length > 1) return ambiguous('ambiguous-bootstrap', boots.map(b => b.id));

    const codeHashes = new Map(), dataHashes = new Map();
    const codeMatches = programs.filter(p => {
      if (!codeHashes.has(p.codeBytes)) codeHashes.set(p.codeBytes, hash(raw.code.subarray(0, p.codeBytes)));
      return codeHashes.get(p.codeBytes) === p.codeSha256;
    });
    if (!codeMatches.length) return unknown('unreviewed-code');
    const matches = codeMatches.filter(p => {
      if (loadedDataBytes < p.dataBytes) return false;
      if (!dataHashes.has(p.dataBytes)) dataHashes.set(p.dataBytes, hash(raw.data.subarray(0, p.dataBytes)));
      return dataHashes.get(p.dataBytes) === p.dataSha256;
    });
    if (!matches.length) return unknown('unreviewed-constants');
    if (matches.length > 1) return ambiguous('ambiguous-identity', matches.map(p => p.id));
    return { status: 'known', identity: matches[0].id, family: matches[0].family, bootstrap: boots[0].id };
  };
}

export const classifyAudioReference = createAudioReferenceClassifier(audioReferenceManifest);
