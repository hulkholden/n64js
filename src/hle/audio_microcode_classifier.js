import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { createMicrocodeHash } from './audio_microcode_hash.js';

const unknown = reason => ({ status: 'unknown', identity: null, family: 'Unknown', reason });
const ambiguous = (reason, entries) => ({ ...unknown(reason), status: 'ambiguous', candidates: entries.map(e => e.id).sort() });
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;
const entryBytes = 0x80;

// A cache hit requires equality of EVERY byte of the protected range. Neither
// object identity, guest addresses nor a short signature establish a hit.
// DataView permits unaligned subviews and avoids host-endianness assumptions.
function equalRange(view, previous) {
  for (let p = 0; p < previous.byteLength; p += 4) {
    if (view.getUint32(p) !== previous.getUint32(p)) return false;
  }
  return true;
}

function compileRanges(entries, sizeKey, digestKey, hash, cache) {
  const ranges = [...new Set(entries.map(e => e[sizeKey]))].map(size => ({
    size, entries: entries.filter(e => e[sizeKey] === size), previous: null, matches: [],
  }));
  return (bytes, candidates = entries) => {
    const matches = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const range of ranges) {
      if (bytes.length < range.size || !range.entries.some(e => candidates.includes(e))) continue;
      if (!range.previous || !equalRange(view, range.previous)) {
        const prefix = bytes.subarray(0, range.size), digest = hash(prefix);
        range.matches = range.entries.filter(e => e[digestKey] === digest);
        // Copy even unknown inputs, so repeated unreviewed code is cheap too.
        // One entry per range keeps memory bounded; caller mutation is harmless.
        if (cache) range.previous = new DataView(new Uint8Array(prefix).buffer);
      }
      matches.push(...range.matches.filter(e => candidates.includes(e)));
    }
    return matches;
  };
}

/** Browser-compatible task-start classifier. The manifest contains only the
 * reference's reviewed ranges and SHA-256 digests, never game instruction bytes.
 * Disabling the cache supports offline measurement without relaxing validation.
 * Create one instance per emulator/reset, retaining it across observed tasks.
 */
export function createAudioMicrocodeClassifier(manifest = audioMicrocodeManifest, { cache = true } = {}) {
  const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  const length = (x, limit) => Number.isInteger(x) && x > 0 && x <= limit && x % 4 === 0;
  const ids = entries => entries.every(e => typeof e?.id === 'string' && e.id.length) && new Set(entries.map(e => e.id)).size === entries.length;
  if (manifest?.version !== 1 || !Array.isArray(manifest.bootstraps) || !manifest.bootstraps.length ||
      !Array.isArray(manifest.programs) || !manifest.programs.length || !ids(manifest.bootstraps) || !ids(manifest.programs) ||
      !manifest.bootstraps.every(b => length(b.bytes, 4096) && digest(b.sha256)) ||
      !manifest.programs.every(p => ['ABI1', 'NAUDIO', 'NEAD', 'Unknown'].includes(p.family) &&
        [undefined, 'rspboot', 'direct'].includes(p.loader) && length(p.codeBytes, p.loader === 'direct' ? 4096 : codeLoadBytes) &&
        length(p.dataBytes, taskOffset) && digest(p.codeSha256) && digest(p.dataSha256) &&
        (p.entrySha256 === undefined || (p.codeBytes >= entryBytes && digest(p.entrySha256))))) {
    throw new Error('Invalid audio reference manifest');
  }
  const boots = manifest.bootstraps.map(b => ({ ...b })), programs = manifest.programs.map(p => ({ ...p, entryBytes }));
  const hash = createMicrocodeHash();
  const bootMatches = compileRanges(boots, 'bytes', 'sha256', hash, cache);
  // This small digest only narrows candidates. Every accepted candidate must
  // still match its entire reviewed code and constants; shared entries are OK.
  const entryMatches = compileRanges(programs.filter(p => p.entrySha256 !== undefined), 'entryBytes', 'entrySha256', hash, cache);
  const codeMatches = compileRanges(programs, 'codeBytes', 'codeSha256', hash, cache);
  const dataMatches = compileRanges(programs, 'dataBytes', 'dataSha256', hash, cache);
  return raw => {
    if (!raw || !['task', 'imem', 'code', 'data'].every(k => raw[k] instanceof Uint8Array) ||
        raw.task.length !== 64 || raw.imem.length !== 4096 || raw.code.length > 4096 || raw.data.length > 4096) return unknown('invalid-snapshot');
    const task = new DataView(raw.task.buffer, raw.task.byteOffset, raw.task.byteLength);
    if (task.getUint32(0) !== 2) return unknown('not-audio-task');
    const codeAddress = task.getUint32(0x10) & 0x1fffffff, dataAddress = task.getUint32(0x18) & 0x1fffffff;
    const direct = (task.getUint32(0x08) & 0x1fffffff) === codeAddress && task.getUint32(0x0c) === 4096;
    const dataSize = task.getUint32(0x1c);
    // The reviewed direct-entry programs write ucode_data_size to RD_LEN
    // unchanged. rspboot subtracts one first. At multiples of eight these
    // conventions load different amounts, including the final constants byte.
    const loadedDataBytes = direct ? Math.floor(dataSize / 8) * 8 + 8 : Math.ceil(dataSize / 8) * 8;
    // Revalidate the layout even on cache hits: data DMA precedes reading the
    // code pointer, so it must not overwrite OSTask at DMEM 0xfc0.
    if (!codeAddress || !dataAddress || (codeAddress & 7) || (dataAddress & 7) || !loadedDataBytes ||
        loadedDataBytes > taskOffset || (!direct && raw.code.length < codeLoadBytes) || raw.data.length < loadedDataBytes) return unknown('unsupported-task-layout');
    let bootstrap = 'direct-imem';
    if (!direct) {
      const loaders = bootMatches(raw.imem);
      if (!loaders.length) return unknown('unreviewed-bootstrap');
      if (loaders.length > 1) return ambiguous('ambiguous-bootstrap', loaders);
      bootstrap = loaders[0].id;
    }
    // Direct tasks already have their program in IMEM. The RDRAM code window
    // is not what they execute, and cannot substitute for the actual image.
    const bytes = direct ? raw.imem : raw.code;
    const layout = programs.filter(p => (p.loader === 'direct') === direct);
    const entries = entryMatches(bytes, layout);
    const code = codeMatches(bytes, layout.filter(p => p.entrySha256 === undefined || entries.includes(p)));
    if (!code.length) return unknown('unreviewed-code');
    const data = dataMatches(raw.data, code);
    const matches = code.filter(p => loadedDataBytes >= p.dataBytes && data.includes(p));
    if (!matches.length) return unknown('unreviewed-constants');
    if (matches.length > 1) return ambiguous('ambiguous-identity', matches);
    return { status: 'known', identity: matches[0].id, family: matches[0].family, bootstrap };
  };
}
