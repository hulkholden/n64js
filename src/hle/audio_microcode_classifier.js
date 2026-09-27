import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { createMicrocodeHash } from './audio_microcode_hash.js';

const unknown = reason => ({ status: 'unknown', identity: null, family: 'Unknown', reason });
const ambiguous = (reason, entries) => ({ ...unknown(reason), status: 'ambiguous', candidates: entries.map(e => e.id).sort() });
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;

// A cache hit requires equality of EVERY byte of the protected range. Neither
// object identity, guest addresses nor a short signature establish a hit.
// DataView permits unaligned subviews and avoids host-endianness assumptions.
function equalRange(view, previous, probe) {
  if (probe) {
    const middle = (previous.byteLength >>> 3) << 2;
    if (view.getUint32(middle) !== previous.getUint32(middle)) return false;
  }
  for (let p = 0; p < previous.byteLength; p += 4) {
    if (view.getUint32(p) !== previous.getUint32(p)) return false;
  }
  return true;
}

function compileRanges(entries, sizeKey, digestKey, hash, cache, probe) {
  const ranges = [...new Set(entries.map(e => e[sizeKey]))].map(size => ({
    size, entries: entries.filter(e => e[sizeKey] === size), previous: null, matches: [],
  }));
  return bytes => {
    const matches = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const range of ranges) {
      if (bytes.length < range.size) continue;
      if (!range.previous || !equalRange(view, range.previous, probe)) {
        const prefix = bytes.subarray(0, range.size), digest = hash(prefix);
        range.matches = range.entries.filter(e => e[digestKey] === digest);
        // Copy even unknown inputs, so repeated unreviewed code is cheap too.
        // One entry per range keeps memory bounded; caller mutation is harmless.
        if (cache) range.previous = new DataView(new Uint8Array(prefix).buffer);
      }
      matches.push(...range.matches);
    }
    return matches;
  };
}

/** Browser-compatible task-start classifier. The manifest contains only the
 * reference's reviewed ranges and SHA-256 digests, never game instruction bytes.
 * cache/probe switches support offline measurement; neither relaxes validation.
 * Create one instance per emulator, retaining it across tasks, when integrated.
 */
export function createAudioMicrocodeClassifier(manifest = audioMicrocodeManifest, { cache = true, probe = false } = {}) {
  const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const length = (x, limit) => Number.isInteger(x) && x > 0 && x <= limit && x % 4 === 0;
  const ids = entries => entries.every(e => typeof e?.id === 'string' && e.id.length) && new Set(entries.map(e => e.id)).size === entries.length;
  if (manifest?.version !== 1 || !Array.isArray(manifest.bootstraps) || !manifest.bootstraps.length ||
      !Array.isArray(manifest.programs) || !manifest.programs.length || !ids(manifest.bootstraps) || !ids(manifest.programs) ||
      !manifest.bootstraps.every(b => length(b.bytes, 4096) && digest(b.sha256)) ||
      !manifest.programs.every(p => p.family === 'ABI1' && length(p.codeBytes, codeLoadBytes) &&
        length(p.dataBytes, taskOffset) && digest(p.codeSha256) && digest(p.dataSha256))) {
    throw new Error('Invalid audio reference manifest');
  }
  const boots = manifest.bootstraps.map(b => ({ ...b })), programs = manifest.programs.map(p => ({ ...p }));
  const hash = createMicrocodeHash();
  const bootMatches = compileRanges(boots, 'bytes', 'sha256', hash, cache, probe);
  const codeMatches = compileRanges(programs, 'codeBytes', 'codeSha256', hash, cache, probe);
  const dataMatches = compileRanges(programs, 'dataBytes', 'dataSha256', hash, cache, probe);
  return raw => {
    if (!raw || !['task', 'imem', 'code', 'data'].every(k => raw[k] instanceof Uint8Array) ||
        raw.task.length !== 64 || raw.imem.length !== 4096 || raw.code.length > 4096 || raw.data.length > 4096) return unknown('invalid-snapshot');
    const task = new DataView(raw.task.buffer, raw.task.byteOffset, raw.task.byteLength);
    if (task.getUint32(0) !== 2) return unknown('not-audio-task');
    const codeAddress = task.getUint32(0x10) & 0x1fffffff, dataAddress = task.getUint32(0x18) & 0x1fffffff;
    const loadedDataBytes = Math.ceil(task.getUint32(0x1c) / 8) * 8;
    // Revalidate the layout even on cache hits: data DMA precedes reading the
    // code pointer, so it must not overwrite OSTask at DMEM 0xfc0.
    if (!codeAddress || !dataAddress || (codeAddress & 7) || (dataAddress & 7) || !loadedDataBytes ||
        loadedDataBytes > taskOffset || raw.code.length < codeLoadBytes || raw.data.length < loadedDataBytes) return unknown('unsupported-task-layout');
    const loaders = bootMatches(raw.imem);
    if (!loaders.length) return unknown('unreviewed-bootstrap');
    if (loaders.length > 1) return ambiguous('ambiguous-bootstrap', loaders);
    const code = codeMatches(raw.code);
    if (!code.length) return unknown('unreviewed-code');
    const data = dataMatches(raw.data);
    const matches = code.filter(p => loadedDataBytes >= p.dataBytes && data.includes(p));
    if (!matches.length) return unknown('unreviewed-constants');
    if (matches.length > 1) return ambiguous('ambiguous-identity', matches);
    return { status: 'known', identity: matches[0].id, family: matches[0].family, bootstrap: loaders[0].id };
  };
}
