import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gzipSync } from 'node:zlib';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = bytes => Buffer.from(bytes).toString('base64');
const integer = value => Number.isSafeInteger(value) && value >= 0;
export const captureFile = 'tasks.jsonl.gz';

export function emptyAudioCapture(directory, instructionLoads = false) {
  return {
    version: instructionLoads ? 2 : 1, scope: instructionLoads ? 'task-start-and-instruction-dma' : 'task-start',
    directory, file: captureFile, bytes: 0, tasks: 0, images: 0,
    ...(instructionLoads ? { loads: 0, instructionImages: 0 } : {}),
  };
}

function validLoad(record, tasks) {
  const aligned = (value, low, high, alignment) => integer(value) && value >= low && value <= high && value % alignment === 0;
  return aligned(record.task, 1, tasks, 1) && aligned(record.rspPC, 0, 0xffc, 4) &&
    aligned(record.source, 0, 0xfffff8, 8) && aligned(record.destination, 0x1000, 0x1ff8, 8) &&
    aligned(record.length, 8, 4096, 8) && aligned(record.count, 1, 256, 1) && aligned(record.skip, 0, 4095, 1) &&
    integer(record.frame) && integer(record.cycles);
}

function encodeImage(image) {
  return {
    code: binary(image.code), data: binary(image.data),
    loadAddress: image.loadAddress, loader: image.loader,
    declared: image.declared, issues: image.issues,
    raw: Object.fromEntries(['task', 'imem', 'code', 'data'].map(key => [key, binary(image.raw[key])])),
  };
}

function decodeBytes(value, maximum, exact) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4) throw new Error('Invalid capture bytes');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum || (exact !== undefined && bytes.length !== exact) || binary(bytes) !== value) {
    throw new Error('Invalid capture bytes');
  }
  return new Uint8Array(bytes);
}

function decodeImage(image) {
  if (!image || !['direct', 'rspboot', 'unknown'].includes(image.loader) ||
      ![null, 0x1000, 0x1080].includes(image.loadAddress) ||
      !['boot', 'code', 'data'].every(key => integer(image.declared?.[key]) && image.declared[key] <= 0xffffffff) ||
      !Array.isArray(image.issues) || !image.issues.every(issue => typeof issue === 'string') || !image.raw) {
    throw new Error('Invalid capture image metadata');
  }
  return {
    ...image, code: decodeBytes(image.code, 0x1000), data: decodeBytes(image.data, 0x1000),
    raw: {
      task: decodeBytes(image.raw.task, 64, 64), imem: decodeBytes(image.raw.imem, 0x1000, 0x1000),
      code: decodeBytes(image.raw.code, 0x1000), data: decodeBytes(image.raw.data, 0x1000),
    },
  };
}

/** Append independent gzip members at checkpoints. A report references an exact
 * compressed prefix, so a killed worker's later/partial write cannot invalidate
 * previously published observations. Deduplication uses the complete snapshot,
 * never the classifier's deliberately incomplete revision fingerprint.
 */
export class AudioMicrocodeCapture {
  constructor(directory, { instructionLoads = false } = {}) {
    this.path = join(directory, captureFile);
    this.images = new Set();
    this.pending = [];
    this.tasks = 0;
    this.loads = 0;
    this.instructionImages = new Set();
    this.failure = null;
    this.published = emptyAudioCapture(directory, instructionLoads);
  }

  observe(image, { frame, cycles }) {
    const encoded = encodeImage(image);
    const id = sha256(JSON.stringify(encoded));
    if (!this.images.has(id)) {
      this.pending.push(JSON.stringify({ type: 'image', id, image: encoded }));
      this.images.add(id);
    }
    this.pending.push(JSON.stringify({ type: 'task', image: id, task: ++this.tasks, frame, cycles }));
  }

  observeInstructionLoad({ imem, ...transfer }, { frame, cycles }) {
    const record = { ...transfer, frame, cycles };
    if (this.published.version !== 2 || imem.length !== 4096 || !validLoad(record, this.tasks)) throw new Error('Invalid instruction DMA observation');
    const id = sha256(imem);
    if (!this.instructionImages.has(id)) {
      this.pending.push(JSON.stringify({ type: 'instruction-image', id, imem: binary(imem) }));
      this.instructionImages.add(id);
    }
    // Deduplicate bytes, never occurrences: repeated/restored code loads matter.
    this.pending.push(JSON.stringify({ type: 'instruction-load', load: ++this.loads, image: id, ...record }));
  }

  flush() {
    if (this.failure) throw this.failure;
    if (!this.pending.length) return;
    const bytes = gzipSync(this.pending.join('\n') + '\n', { level: 1 });
    try {
      appendFileSync(this.path, bytes);
    } catch (error) {
      // A failed append may have written part of a member. Never append/retry
      // behind that tail and publish a prefix that would include corrupt bytes.
      this.failure = error;
      throw error;
    }
    this.published = {
      ...this.published, bytes: this.published.bytes + bytes.length, tasks: this.tasks, images: this.images.size,
      ...(this.published.version === 2 ? { loads: this.loads, instructionImages: this.instructionImages.size } : {}),
    };
    this.pending = [];
  }

  snapshot() {
    return { ...this.published };
  }
}

export async function readCaptureReport(directory) {
  const bytes = await readFile(join(directory, 'report.json'));
  const report = JSON.parse(bytes);
  const capture = report.audioCapture;
  const validVersion = (capture?.version === 1 && capture.scope === 'task-start') ||
    (capture?.version === 2 && capture.scope === 'task-start-and-instruction-dma' &&
      integer(capture.loads) && integer(capture.instructionImages) && capture.instructionImages <= capture.loads);
  if (report.schemaVersion !== 1 || !validVersion || capture.file !== captureFile ||
      !['bytes', 'tasks', 'images'].every(key => integer(capture[key])) || capture.images > capture.tasks ||
      !report.settings || !report.emulator || !/^[a-f0-9]{64}$/.test(report.sourceSha256)) {
    throw new Error(`Invalid audio capture report: ${directory}`);
  }
  return { report, reportSha256: sha256(bytes) };
}

/** Replay raw evidence without loading a ROM or starting an emulator. Resolve
 * files relative to the supplied directory, so corpora can be moved/archived.
 * Consumers may use task.image.raw to derive a new loader or classifier.
 */
export async function* readAudioCaptureEvents(directory, capture) {
  const path = join(directory, captureFile);
  if ((await stat(path)).size < capture.bytes) throw new Error(`Truncated audio capture: ${path}`);
  const images = new Map();
  const instructionImages = new Map();
  let tasks = 0;
  let loads = 0;
  if (capture.bytes) {
    const source = createReadStream(path, { start: 0, end: capture.bytes - 1 });
    const uncompressed = createGunzip();
    source.on('error', error => uncompressed.destroy(error));
    source.pipe(uncompressed);
    const lines = createInterface({ input: uncompressed, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const record = JSON.parse(line);
        if (record.type === 'image') {
          if (record.id !== sha256(JSON.stringify(record.image)) || images.has(record.id)) throw new Error('Invalid or duplicate capture image hash');
          images.set(record.id, decodeImage(record.image));
        } else if (record.type === 'task') {
          if (record.task !== ++tasks || !images.has(record.image) || !integer(record.frame) || !integer(record.cycles)) {
            throw new Error('Invalid capture task occurrence');
          }
          yield { ...record, imageId: record.image, image: images.get(record.image) };
        } else if (capture.version === 2 && record.type === 'instruction-image') {
          const imem = decodeBytes(record.imem, 4096, 4096);
          if (record.id !== sha256(imem) || instructionImages.has(record.id)) throw new Error('Invalid or duplicate instruction image hash');
          instructionImages.set(record.id, imem);
        } else if (capture.version === 2 && record.type === 'instruction-load') {
          if (record.load !== ++loads || !instructionImages.has(record.image) || !validLoad(record, tasks)) throw new Error('Invalid instruction DMA occurrence');
          yield { ...record, imageId: record.image, image: instructionImages.get(record.image) };
        } else throw new Error('Unknown audio capture record');
      }
    } finally {
      lines.close();
      source.destroy();
      uncompressed.destroy();
    }
  }
  if (tasks !== capture.tasks || images.size !== capture.images) throw new Error('Audio capture counts do not match report');
  if (capture.version === 2 && (loads !== capture.loads || instructionImages.size !== capture.instructionImages)) throw new Error('Instruction capture counts do not match report');
}

// Preserve the task-only API, but still consume and validate instruction records.
export async function* readAudioCapture(directory, capture) {
  for await (const event of readAudioCaptureEvents(directory, capture)) if (event.type === 'task') yield event;
}
