import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { createMicrocodeHash } from './audio_microcode_hash.js';

const rspMemoryBytes = 0x1000;
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;
const entryBytes = 0x80;

function unknown(reason) {
  return {
    status: 'unknown',
    identity: null,
    family: 'Unknown',
    reason,
  };
}

function ambiguous(reason, entries) {
  return {
    ...unknown(reason),
    status: 'ambiguous',
    candidates: entries.map(entry => entry.id).sort(),
  };
}

function isSha256Digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isRangeLength(value, limit) {
  return Number.isInteger(value) && value > 0 && value <= limit && value % 4 === 0;
}

function hasUniqueIds(entries) {
  const allIdsPresent = entries.every(entry => typeof entry?.id === 'string' && entry.id.length);
  if (!allIdsPresent) {
    return false;
  }

  const ids = entries.map(entry => entry.id);
  return new Set(ids).size === entries.length;
}

function isValidManifest(manifest) {
  if (manifest?.version !== 1 ||
      !Array.isArray(manifest.bootstraps) || manifest.bootstraps.length === 0 ||
      !Array.isArray(manifest.programs) || manifest.programs.length === 0) {
    return false;
  }

  if (!hasUniqueIds(manifest.bootstraps) || !hasUniqueIds(manifest.programs)) {
    return false;
  }

  const validBootstraps = manifest.bootstraps.every(bootstrap =>
    isRangeLength(bootstrap.bytes, rspMemoryBytes) && isSha256Digest(bootstrap.sha256));

  if (!validBootstraps) {
    return false;
  }

  return manifest.programs.every(program => {
    const codeLimit = program.loader === 'direct' ? rspMemoryBytes : codeLoadBytes;

    return ['ABI1', 'NAUDIO', 'NEAD', 'Unknown'].includes(program.family) &&
      [undefined, 'rspboot', 'direct'].includes(program.loader) &&
      isRangeLength(program.codeBytes, codeLimit) &&
      isRangeLength(program.dataBytes, taskOffset) &&
      isSha256Digest(program.codeSha256) &&
      isSha256Digest(program.dataSha256) &&
      (program.entrySha256 === undefined ||
        (program.codeBytes >= entryBytes && isSha256Digest(program.entrySha256)));
  });
}

// A cache hit requires equality of EVERY byte of the protected range. Neither
// object identity, guest addresses nor a short signature establish a hit.
// DataView permits unaligned subviews and avoids host-endianness assumptions.
function equalRange(view, previous) {
  for (let p = 0; p < previous.byteLength; p += 4) {
    if (view.getUint32(p) !== previous.getUint32(p)) {
      return false;
    }
  }

  return true;
}

/** Prepare a reusable matcher for one kind of protected range: bootstrap,
 * entry prefix, program code or constants. sizeKey and digestKey select the
 * manifest fields to compare, such as codeBytes and codeSha256. Every range
 * starts at byte zero. Entries with the same length share one hash calculation
 * over the input prefix, even when their expected digests differ.
 *
 * This setup runs once when the classifier is created. The returned function
 * accepts a byte window and an optional subset of candidate entries, then
 * returns every candidate whose protected prefix matches. It skips ranges
 * longer than the window and lengths that have no remaining candidates. The
 * caller combines these matches with the loading-layout and other range checks
 * to establish an identity; a match here is not sufficient on its own.
 *
 * With caching enabled, each length retains a private copy of the last checked
 * prefix and the entries that matched its digest. Reusing that result requires
 * comparing every protected byte, so callers can safely reuse or mutate their
 * input buffers. Empty match lists are cached too, making repeated unknown
 * inputs cheap. Storage is bounded by the distinct manifest lengths, not the
 * number of tasks. Disabling caching hashes each eligible prefix on every call.
 *
 * Cached match lists cover ALL entries of that length, while returned results
 * are filtered to the current candidates. This lets successive calls use
 * different candidate subsets without losing matches excluded by an earlier
 * call. Candidate entries must be the same objects supplied during setup.
 */
function compileRanges(entries, sizeKey, digestKey, hash, cache) {
  const sizes = [...new Set(entries.map(entry => entry[sizeKey]))];
  const ranges = sizes.map(size => ({
    size,
    entries: entries.filter(entry => entry[sizeKey] === size),
    previous: null,
    matches: [],
  }));

  return (bytes, candidates = entries) => {
    const matches = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (const range of ranges) {
      if (bytes.length < range.size) {
        continue;
      }

      const hasCandidates = range.entries.some(entry => candidates.includes(entry));
      if (!hasCandidates) {
        continue;
      }

      if (!range.previous || !equalRange(view, range.previous)) {
        const prefix = bytes.subarray(0, range.size);
        const digest = hash(prefix);
        range.matches = range.entries.filter(entry => entry[digestKey] === digest);

        // Copy even unknown inputs, so repeated unreviewed code is cheap too.
        // One entry per range keeps memory bounded; caller mutation is harmless.
        if (cache) {
          range.previous = new DataView(new Uint8Array(prefix).buffer);
        }
      }

      matches.push(...range.matches.filter(entry => candidates.includes(entry)));
    }

    return matches;
  };
}

/** Browser-compatible task-start classifier. The manifest contains only
 * reviewed ranges and SHA-256 digests, never game instruction bytes.
 * Disabling the cache supports offline measurement without relaxing validation.
 * Create one instance per emulator/reset, retaining it across observed tasks.
 *
 * Usage: const classify = createAudioMicrocodeClassifier(); classify(raw);
 * raw contains four Uint8Arrays in N64 byte order: task (64-byte OSTask), imem
 * (4 KiB at task start), code and data (up to 4 KiB copied from the task's
 * RDRAM ucode and ucode_data addresses). Include bytes beyond declared sizes:
 * loaders use their own transfer lengths and round DMA to eight-byte units.
 * Caller buffers may be reused or mutated between calls; cache copies are private.
 *
 * Results have status known/unknown/ambiguous, identity and family. Known results
 * also name the bootstrap; other results explain the reason, with candidates
 * for ambiguity. Classification does not execute the task or select an HLE handler.
 */
export function createAudioMicrocodeClassifier(manifest = audioMicrocodeManifest, { cache = true } = {}) {
  if (!isValidManifest(manifest)) {
    throw new Error('Invalid audio reference manifest');
  }

  const bootstraps = manifest.bootstraps.map(bootstrap => ({ ...bootstrap }));
  const programs = manifest.programs.map(program => ({ ...program, entryBytes }));
  const hash = createMicrocodeHash();

  const matchBootstraps = compileRanges(bootstraps, 'bytes', 'sha256', hash, cache);

  // This small digest only narrows candidates. Every accepted candidate must
  // still match its entire reviewed code and constants; shared entries are OK.
  const programsWithEntryHashes = programs.filter(program => program.entrySha256 !== undefined);
  const matchEntries = compileRanges(programsWithEntryHashes, 'entryBytes', 'entrySha256', hash, cache);
  const matchCode = compileRanges(programs, 'codeBytes', 'codeSha256', hash, cache);
  const matchConstants = compileRanges(programs, 'dataBytes', 'dataSha256', hash, cache);

  return raw => {
    if (!raw ||
        !['task', 'imem', 'code', 'data'].every(key => raw[key] instanceof Uint8Array) ||
        raw.task.length !== 64 || raw.imem.length !== rspMemoryBytes ||
        raw.code.length > rspMemoryBytes || raw.data.length > rspMemoryBytes) {
      return unknown('invalid-snapshot');
    }

    const task = new DataView(raw.task.buffer, raw.task.byteOffset, raw.task.byteLength);
    if (task.getUint32(0) !== 2) {
      return unknown('not-audio-task');
    }

    const bootAddress = task.getUint32(0x08) & 0x1fffffff;
    const bootSize = task.getUint32(0x0c);
    const codeAddress = task.getUint32(0x10) & 0x1fffffff;
    const dataAddress = task.getUint32(0x18) & 0x1fffffff;
    const dataSize = task.getUint32(0x1c);
    const direct = bootAddress === codeAddress && bootSize === rspMemoryBytes;

    // The reviewed direct-entry programs write ucode_data_size to RD_LEN
    // unchanged. rspboot subtracts one first. At multiples of eight these
    // conventions load different amounts, including the final constants byte.
    const loadedDataBytes = direct
      ? Math.floor(dataSize / 8) * 8 + 8
      : Math.ceil(dataSize / 8) * 8;

    // Revalidate the layout even on cache hits: data DMA precedes reading the
    // code pointer, so it must not overwrite OSTask at DMEM 0xfc0.
    if (!codeAddress || !dataAddress || (codeAddress & 7) || (dataAddress & 7) ||
        !loadedDataBytes || loadedDataBytes > taskOffset ||
        (!direct && raw.code.length < codeLoadBytes) || raw.data.length < loadedDataBytes) {
      return unknown('unsupported-task-layout');
    }

    let bootstrap = 'direct-imem';
    if (!direct) {
      const loaders = matchBootstraps(raw.imem);
      if (loaders.length === 0) {
        return unknown('unreviewed-bootstrap');
      }
      if (loaders.length > 1) {
        return ambiguous('ambiguous-bootstrap', loaders);
      }

      bootstrap = loaders[0].id;
    }

    // Direct tasks already have their program in IMEM. The RDRAM code window
    // is not what they execute, and cannot substitute for the actual image.
    const programBytes = direct ? raw.imem : raw.code;
    const layoutCandidates = programs.filter(program => (program.loader === 'direct') === direct);
    const matchingEntries = matchEntries(programBytes, layoutCandidates);
    const codeCandidates = layoutCandidates.filter(program =>
      program.entrySha256 === undefined || matchingEntries.includes(program));

    const matchingCode = matchCode(programBytes, codeCandidates);
    if (matchingCode.length === 0) {
      return unknown('unreviewed-code');
    }

    const matchingConstants = matchConstants(raw.data, matchingCode);
    const matches = matchingCode.filter(program =>
      loadedDataBytes >= program.dataBytes && matchingConstants.includes(program));

    if (matches.length === 0) {
      return unknown('unreviewed-constants');
    }
    if (matches.length > 1) {
      return ambiguous('ambiguous-identity', matches);
    }

    return {
      status: 'known',
      identity: matches[0].id,
      family: matches[0].family,
      bootstrap,
    };
  };
}
