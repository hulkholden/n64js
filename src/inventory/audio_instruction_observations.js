import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Observed IMEM states and ordered DMA sequences, NOT classifier inputs or
 * program identities. Sources/PCs/times remain in the original event stream.
 * Keep tasks until EOF: an older task's queued DMA can arrive after a new start.
 */
export class AudioInstructionObservations {
  constructor() {
    this.tasks = new Map();
    this.images = new Map();
    this.loads = 0;
  }

  observe(event) {
    if (event.type === 'task') {
      this.tasks.set(event.task, { initialImemSha256: hash(event.image.raw.imem), loads: [] });
      return;
    }
    this.loads++;
    if (!this.images.has(event.imageId)) this.images.set(event.imageId, {
      imageId: event.imageId, loads: 0, reference: { task: event.task, load: event.load },
    });
    this.images.get(event.imageId).loads++;
    const { imageId, destination, length, count, skip } = event;
    this.tasks.get(event.task).loads.push({ imageId, destination, length, count, skip });
  }

  snapshot() {
    const sequences = new Map();
    for (const [task, sequence] of this.tasks) {
      const id = hash(JSON.stringify(sequence));
      if (!sequences.has(id)) sequences.set(id, { id, ...sequence, tasks: 0, reference: { task } });
      sequences.get(id).tasks++;
    }
    return {
      scope: 'observed-instruction-dma', loads: this.loads,
      tasksWithLoads: [...this.tasks.values()].filter(task => task.loads.length).length,
      images: [...this.images.values()].sort((a, b) => a.imageId.localeCompare(b.imageId)),
      sequences: [...sequences.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }
}
