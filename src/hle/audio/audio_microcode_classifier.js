import { audioMicrocodeManifest } from './audio_microcode_manifest.js';
import { createMicrocodeHash } from './audio_microcode_hash.js';

const rspMemoryBytes = 0x1000;
const codeLoadBytes = 0xf80;
const taskOffset = 0xfc0;
const entryBytes = 0x80;

function unknown(reason, result) {
  result.status = 'unknown';
  result.identity = null;
  result.family = 'Unknown';
  result.reason = reason;
  if ('bootstrap' in result) {
    delete result.bootstrap;
  }
  if ('candidates' in result) {
    delete result.candidates;
  }
  return result;
}

function ambiguous(reason, matches, result) {
  unknown(reason, result);
  result.status = 'ambiguous';
  result.candidates = matches.entries.slice(0, matches.count).map(entry => entry.id).sort();
  return result;
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

// Fixed-capacity result lists retain their backing storage between tasks.
// Only entries below count are live; callers must consume them synchronously.
function contains(matches, entry) {
  for (let i = 0; i < matches.count; i++) {
    if (matches.entries[i] === entry) {
      return true;
    }
  }
  return false;
}

/** Prepare a reusable matcher for one kind of protected range: bootstrap,
 * entry prefix, program code or constants. sizeKey and digestKey select the
 * manifest fields to compare, such as codeBytes and codeSha256. Every range
 * starts at byte zero. Results are a reusable { entries, count } list. Entries
 * with the same length share one hash calculation over the input prefix, even
 * when their expected digests differ.
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
    matches: { entries: new Array(entries.length), count: 0 },
  }));
  const matches = { entries: new Array(entries.length), count: 0 };
  let previousBytes, view;

  return (bytes, candidates) => {
    matches.count = 0;
    if (previousBytes !== bytes) {
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      previousBytes = bytes;
    }

    for (let r = 0; r < ranges.length; r++) {
      const range = ranges[r];
      if (bytes.length < range.size) {
        continue;
      }

      let hasCandidates = !candidates;
      if (candidates) {
        for (let i = 0; i < range.entries.length; i++) {
          if (contains(candidates, range.entries[i])) {
            hasCandidates = true; break;
          }
        }
      }
      if (!hasCandidates) {
        continue;
      }

      if (!range.previous || !equalRange(view, range.previous)) {
        const prefix = bytes.subarray(0, range.size);
        const digest = hash(prefix);
        range.matches.count = 0;
        for (const entry of range.entries) {
          if (entry[digestKey] === digest) {
            range.matches.entries[range.matches.count++] = entry;
          }
        }

        // Copy even unknown inputs, so repeated unreviewed code is cheap too.
        // One entry per range keeps memory bounded; caller mutation is harmless.
        if (cache) {
          if (!range.previous) {
            range.previous = new DataView(new ArrayBuffer(range.size));
          }
          for (let p = 0; p < range.size; p += 4) {
            range.previous.setUint32(p, view.getUint32(p));
          }
        }
      }

      for (let i = 0; i < range.matches.count; i++) {
        const entry = range.matches.entries[i];
        if (!candidates || contains(candidates, entry)) {
          matches.entries[matches.count++] = entry;
        }
      }
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
 * Pass a private second result object to reuse it; omission returns a fresh
 * caller-owned result. Neither form exposes the classifier's internal caches.
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
  const rspbootPrograms = programs.filter(program => program.loader !== 'direct');
  const directPrograms = programs.filter(program => program.loader === 'direct');
  const rspbootCandidates = { entries: rspbootPrograms, count: rspbootPrograms.length };
  const directCandidates = { entries: directPrograms, count: directPrograms.length };
  const codeCandidates = { entries: new Array(programs.length), count: 0 };
  let previousTask, task;

  return (raw, result = {}) => {
    if (!raw ||
        !(raw.task instanceof Uint8Array) || !(raw.imem instanceof Uint8Array) ||
        !(raw.code instanceof Uint8Array) || !(raw.data instanceof Uint8Array) ||
        raw.task.length !== 64 || raw.imem.length !== rspMemoryBytes ||
        raw.code.length > rspMemoryBytes || raw.data.length > rspMemoryBytes) {
      return unknown('invalid-snapshot', result);
    }

    if (previousTask !== raw.task) {
      task = new DataView(raw.task.buffer, raw.task.byteOffset, raw.task.byteLength);
      previousTask = raw.task;
    }
    if (task.getUint32(0) !== 2) {
      return unknown('not-audio-task', result);
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
      return unknown('unsupported-task-layout', result);
    }

    let bootstrap = 'direct-imem';
    if (!direct) {
      const loaders = matchBootstraps(raw.imem);
      if (loaders.count === 0) {
        return unknown('unreviewed-bootstrap', result);
      }
      if (loaders.count > 1) {
        return ambiguous('ambiguous-bootstrap', loaders, result);
      }

      bootstrap = loaders.entries[0].id;
    }

    // Direct tasks already have their program in IMEM. The RDRAM code window
    // is not what they execute, and cannot substitute for the actual image.
    const programBytes = direct ? raw.imem : raw.code;
    const layoutCandidates = direct ? directCandidates : rspbootCandidates;
    const matchingEntries = matchEntries(programBytes, layoutCandidates);
    codeCandidates.count = 0;
    for (let i = 0; i < layoutCandidates.count; i++) {
      const program = layoutCandidates.entries[i];
      if (program.entrySha256 === undefined || contains(matchingEntries, program)) {
        codeCandidates.entries[codeCandidates.count++] = program;
      }
    }

    const matchingCode = matchCode(programBytes, codeCandidates);
    if (matchingCode.count === 0) {
      return unknown('unreviewed-code', result);
    }

    const matches = matchConstants(raw.data, matchingCode);
    let count = 0;
    for (let i = 0; i < matches.count; i++) {
      const program = matches.entries[i];
      if (loadedDataBytes >= program.dataBytes) {
        matches.entries[count++] = program;
      }
    }
    matches.count = count;

    if (matches.count === 0) {
      return unknown('unreviewed-constants', result);
    }
    if (matches.count > 1) {
      return ambiguous('ambiguous-identity', matches, result);
    }

    result.status = 'known';
    result.identity = matches.entries[0].id;
    result.family = matches.entries[0].family;
    result.bootstrap = bootstrap;
    if ('reason' in result) {
      delete result.reason;
    }
    if ('candidates' in result) {
      delete result.candidates;
    }
    return result;
  };
}
