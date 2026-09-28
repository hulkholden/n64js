import { createHash } from 'node:crypto';
import { audioReferenceManifest } from './audio_reference_manifest.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unknown = reason => ({ status: 'unknown', identity: null, family: 'Unknown', reason });
const ambiguous = (reason, candidates) => ({ ...unknown(reason), status: 'ambiguous', candidates: candidates.sort() });
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;

/** Compile an explicitly reviewed manifest. The factory also permits synthetic
 * manifests in tests, without committing captured game bytes. rspboot copies
 * task data to DMEM 0, then 0xf80 code bytes to IMEM 0x1080. Reviewed direct
 * programs start in IMEM and load their own data with an encoded DMA length.
 */
export function createAudioReferenceClassifier(manifest) {
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const length = (value, limit) => Number.isInteger(value) && value > 0 && value <= limit && value % 4 === 0;
  const uniqueIDs = entries => entries.every(e => typeof e.id === 'string' && e.id.length) && new Set(entries.map(e => e.id)).size === entries.length;
  if (manifest?.version !== 1 || !Array.isArray(manifest.bootstraps) || !manifest.bootstraps.length ||
      !Array.isArray(manifest.programs) || !manifest.programs.length ||
      !uniqueIDs(manifest.bootstraps) || !uniqueIDs(manifest.programs) ||
      !manifest.bootstraps.every(b => length(b.bytes, 4096) && digest(b.sha256)) ||
      !manifest.programs.every(p => ['ABI1', 'NAUDIO', 'NEAD', 'Unknown'].includes(p.family) &&
        (p.loader === undefined || p.loader === 'rspboot' || p.loader === 'direct') &&
        length(p.codeBytes, p.loader === 'direct' ? 0x1000 : codeLoadBytes) &&
        length(p.dataBytes, taskOffset) && digest(p.codeSha256) && digest(p.dataSha256) &&
        (p.entrySha256 === undefined || (p.codeBytes >= 0x80 && digest(p.entrySha256))))) {
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
    const direct = task.getUint32(0x0c) === 0x1000 && (task.getUint32(0x08) & 0x1fffffff) === codeAddress;
    // These bootstraps ignore ucode_size. They round the data DMA up to eight
    // bytes. Reject truncation, alignment changes and a data DMA that overwrites
    // the OSTask header before the subsequent code-pointer load.
    // Direct entry does not subtract one from the size before writing RD_LEN.
    const loadedDataBytes = Math.ceil((dataSize + (direct ? 1 : 0)) / 8) * 8;
    if (!codeAddress || !dataAddress || (codeAddress & 7) || (dataAddress & 7) ||
        (!direct && raw.code.length < codeLoadBytes) || !loadedDataBytes || loadedDataBytes > taskOffset || raw.data.length < loadedDataBytes) {
      return unknown('unsupported-task-layout');
    }
    let bootstrap = 'direct-imem';
    if (!direct) {
      const bootHashes = new Map();
      const boots = bootstraps.filter(b => {
        if (!bootHashes.has(b.bytes)) bootHashes.set(b.bytes, hash(raw.imem.subarray(0, b.bytes)));
        return bootHashes.get(b.bytes) === b.sha256;
      });
      if (!boots.length) return unknown('unreviewed-bootstrap');
      if (boots.length > 1) return ambiguous('ambiguous-bootstrap', boots.map(b => b.id));
      bootstrap = boots[0].id;
    }

    const codeHashes = new Map(), dataHashes = new Map();
    const codeBytes = direct ? raw.imem : raw.code;
    // Deliberately ignore the browser's entry-hash shortcut. Full native hashes
    // independently verify both the shortcut and its manifest metadata.
    const codeMatches = programs.filter(p => {
      if ((p.loader === 'direct') !== direct) return false;
      if (!codeHashes.has(p.codeBytes)) codeHashes.set(p.codeBytes, hash(codeBytes.subarray(0, p.codeBytes)));
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
    return { status: 'known', identity: matches[0].id, family: matches[0].family, bootstrap };
  };
}

export const classifyAudioReference = createAudioReferenceClassifier(audioReferenceManifest);
