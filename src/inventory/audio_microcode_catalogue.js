import { createHash } from 'node:crypto';
import { AudioMicrocodeCollector } from './audio_microcode_collector.js';
import { readAudioCapture, readCaptureReport } from './audio_microcode_capture.js';
import { disassembleInstruction } from '../rsp/disassemble_rsp.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = ['code', 'data', 'raw.code', 'raw.data', 'raw.imem', 'raw.task'];
const bytesAt = (image, field) => field.startsWith('raw.') ? image.raw[field.slice(4)] : image[field];
const sorted = values => [...values].sort();

// Half-open byte ranges. Missing bytes count as differences, including when
// one window is empty or shorter because it reached the end of RDRAM.
export function differenceRanges(left, right) {
  const ranges = [];
  let start = null;
  for (let offset = 0; offset <= Math.max(left.length, right.length); offset++) {
    const different = left[offset] !== right[offset];
    if (different && start === null) start = offset;
    if (!different && start !== null) { ranges.push([start, offset]); start = null; }
  }
  return ranges;
}

class ByteObservations {
  constructor() {
    this.reference = null;
    this.changed = new Uint8Array(0);
    this.lengths = new Set();
    this.hashes = new Set();
  }

  observe(bytes, sha256) {
    if (this.hashes.has(sha256)) return;
    this.hashes.add(sha256);
    this.lengths.add(bytes.length);
    this.reference ??= bytes.slice();
    if (this.changed.length < bytes.length) {
      const changed = new Uint8Array(bytes.length);
      changed.set(this.changed);
      this.changed = changed;
    }
    for (const [start, end] of differenceRanges(this.reference, bytes)) this.changed.fill(1, start, end);
  }

  snapshot() {
    const varyingRanges = differenceRanges(new Uint8Array(this.changed.length), this.changed);
    return {
      lengths: [...this.lengths].sort((a, b) => a - b), variants: this.hashes.size,
      varyingBytes: this.changed.reduce((sum, byte) => sum + byte, 0), varyingRanges,
    };
  }
}

const reference = (run, task) => ({ run, task: task.task, imageId: task.imageId });
const observations = () => Object.fromEntries(fields.map(field => [field, new ByteObservations()]));
const summarize = state => Object.fromEntries(fields.map(field => [field, state[field].snapshot()]));

/** Build an evidence catalogue, without deciding which differences are safe
 * to ignore. Exact variants include all interpreted code AND data, load mapping
 * and issues. Raw windows are audited separately; their original image IDs
 * remain in the capture stream. Neither layer asserts HLE equivalence.
 */
export async function catalogueAudioCaptures(directories) {
  const runs = [], groups = new Map(), variants = new Map();
  for (const directory of sorted(new Set(directories))) {
    const { report, reportSha256 } = await readCaptureReport(directory);
    const run = runs.length;
    const seen = new Map(), runGroups = new Map();
    for await (const task of readAudioCapture(directory, report.audioCapture)) {
      let observation = seen.get(task.imageId);
      if (!observation) {
        const { image } = task;
        const collector = new AudioMicrocodeCollector();
        collector.observe(image);
        const provisional = collector.snapshot().microcodes[0];
        const hashes = Object.fromEntries(fields.map(field => [field, hash(bytesAt(image, field))]));
        const interpretation = { loader: image.loader, loadAddress: image.loadAddress, issues: image.issues };
        const id = hash(JSON.stringify([interpretation, hashes.code, hashes.data]));
        if (!variants.has(id)) variants.set(id, {
          id, ...interpretation, codeSha256: hashes.code, dataSha256: hashes.data,
          codeBytes: image.code.length, dataBytes: image.data.length,
          reference: reference(run, task), tasks: 0, runs: new Set(), fingerprints: new Set(),
        });
        let group = groups.get(provisional.fingerprint);
        if (!group) {
          group = {
            provisional, reference: reference(run, task), tasks: 0, images: 0,
            runs: new Set(), variants: new Set(), bytes: observations(),
          };
          groups.set(provisional.fingerprint, group);
        }
        let local = runGroups.get(provisional.fingerprint);
        if (!local) {
          local = { fingerprint: provisional.fingerprint, reference: reference(run, task), tasks: 0, images: 0, variants: new Set(), bytes: observations() };
          runGroups.set(provisional.fingerprint, local);
        }
        for (const state of [group, local]) {
          state.images++;
          state.variants.add(id);
          for (const field of fields) state.bytes[field].observe(bytesAt(image, field), hashes[field]);
        }
        observation = { group, local, variant: variants.get(id) };
        seen.set(task.imageId, observation);
      }
      for (const state of [observation.group, observation.local, observation.variant]) state.tasks++;
      observation.group.runs.add(run);
      observation.variant.runs.add(run);
      observation.variant.fingerprints.add(observation.group.provisional.fingerprint);
    }
    runs.push({
      directory, reportSha256,
      source: { rom: report.rom, emulator: report.emulator, sourceSha256: report.sourceSha256, settings: report.settings, result: report.result },
      capture: report.audioCapture,
      groups: [...runGroups.values()].map(group => ({
        fingerprint: group.fingerprint, reference: group.reference, tasks: group.tasks, images: group.images,
        exactVariants: group.variants.size, bytes: summarize(group.bytes),
      })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    });
  }
  return {
    schemaVersion: 1, scope: 'task-start-byte-evidence',
    summary: {
      runs: runs.length, empty: runs.filter(run => !run.capture.tasks).length,
      partial: runs.filter(run => run.source.result.checkpointOnly).length,
      tasks: runs.reduce((sum, run) => sum + run.capture.tasks, 0),
      images: runs.reduce((sum, run) => sum + run.capture.images, 0),
      provisionalGroups: groups.size, exactVariants: variants.size,
    },
    runs,
    groups: [...groups.values()].map(group => {
      // The collector's first-observation task count isn't a group total.
      const provisional = { ...group.provisional };
      delete provisional.tasks;
      return {
        ...provisional, reference: group.reference, tasks: group.tasks, images: group.images,
        runs: [...group.runs].sort((a, b) => a - b), exactVariants: group.variants.size,
        bytes: summarize(group.bytes),
      };
    }).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    variants: [...variants.values()].map(variant => ({
      ...variant, runs: [...variant.runs].sort((a, b) => a - b), fingerprints: sorted(variant.fingerprints),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Read to the END even when selecting task 1: corruption in the remainder or
 * a published count mismatch must fail a comparison, just as it fails replay.
 */
export async function readCaptureTask(directory, ordinal = 1) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Task ordinal must be a positive integer');
  const { report, reportSha256 } = await readCaptureReport(directory);
  let selected;
  for await (const task of readAudioCapture(directory, report.audioCapture)) if (task.task === ordinal) selected = task;
  if (!selected) throw new Error(`Task ${ordinal} not found in ${directory}`);
  return { directory, reportSha256, rom: report.rom, ...selected };
}

function instructionAt(bytes, offset, address) {
  if (offset + 4 > bytes.length) return null;
  const word = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
  if (address === null) return { word, address: null, disassembly: null };
  // Raw windows can contain data with encodings unsupported by the debugger's
  // disassembler. Preserve those words; don't abort the evidence comparison.
  let disassembly;
  try { disassembly = disassembleInstruction(address, word).disassembly; }
  catch { disassembly = 'undecodable word'; }
  return { word, address, disassembly };
}

export function compareAudioImages(left, right) {
  return fields.map(field => {
    const a = bytesAt(left, field), b = bytesAt(right, field);
    const ranges = differenceRanges(a, b);
    const result = { field, leftBytes: a.length, rightBytes: b.length, leftSha256: hash(a), rightSha256: hash(b), ranges };
    // Code is annotated as a linear decode, NOT a claim that all these words
    // execute. Raw code has no established mapping for an unsupported loader.
    if (['code', 'raw.code', 'raw.imem'].includes(field)) {
      const offsets = new Set();
      for (const [start, end] of ranges) {
        for (let offset = Math.max(0, (start & ~3) - 4); offset < Math.min(Math.max(a.length, b.length), ((end + 3) & ~3) + 4); offset += 4) offsets.add(offset);
      }
      const address = (image, offset) => {
        if (field === 'raw.imem') return 0x1000 + offset;
        if (image.loadAddress === null || (field === 'raw.code' && (image.loader === 'direct' || offset >= image.code.length))) return null;
        return image.loadAddress + offset;
      };
      result.words = [...offsets].sort((x, y) => x - y).map(offset => ({
        offset,
        leftHex: Buffer.from(a.subarray(offset, offset + 4)).toString('hex'),
        rightHex: Buffer.from(b.subarray(offset, offset + 4)).toString('hex'),
        left: instructionAt(a, offset, address(left, offset)),
        right: instructionAt(b, offset, address(right, offset)),
      }));
    } else {
      result.changes = ranges.map(([start, end]) => ({
        start, end, left: Buffer.from(a.subarray(start, end)).toString('hex'), right: Buffer.from(b.subarray(start, end)).toString('hex'),
      }));
    }
    return result;
  });
}

export function catalogueMarkdown(catalogue) {
  const s = catalogue.summary;
  const lines = [
    '# Audio microcode evidence catalogue', '',
    `${s.runs} runs (${s.empty} empty, ${s.partial} partial), ${s.tasks} tasks, ${s.images} captured images.`,
    `${s.provisionalGroups} provisional fingerprints; ${s.exactVariants} exact interpreted code/data variants.`, '',
    'Exact variants retain every interpreted byte. They may differ only in copied tails or scratch data; they are not a count of distinct programs.',
    'Varying ranges describe observations, not masks to apply. Stable bytes are not proven constants. No identity in this report certifies HLE compatibility.', '',
    '| Fingerprint | Family | Runs | Exact variants | Code images | Data images | Varying code bytes |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const group of catalogue.groups) lines.push(`| ${group.fingerprint} | ${group.family} | ${group.runs.length} | ${group.exactVariants} | ${group.bytes.code.variants} | ${group.bytes.data.variants} | ${group.bytes.code.varyingBytes} |`);
  lines.push('', 'The JSON catalogue includes source and report hashes, per-run variation, exact variant hashes and representative task/image references. Comparisons must use these references rather than ROM names as identities.', '');
  return lines.join('\n');
}
