import { createHash } from 'node:crypto';
import { audioMicrocodeIdentity, identifyAudioMicrocode } from '../hle/audio_microcode.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export class AudioMicrocodeCollector {
  constructor({ classifications = false } = {}) {
    this.tasks = 0;
    this.microcodes = new Map();
    this.classifications = classifications;
  }

  observe(image, classification) {
    if (this.classifications && !classification) throw new Error('Missing audio task classification');
    this.tasks++;
    const identification = identifyAudioMicrocode(image);
    const identity = audioMicrocodeIdentity(image, identification);
    const codeHash = sha256(identity.code);
    const dataHash = sha256(identity.data);
    // Delimited hashes include both images and their interpretation. A changed
    // image at the same guest address must trigger a fresh classification.
    const fingerprint = sha256(JSON.stringify([identity.scope, image.loader, image.loadAddress, image.issues, codeHash, dataHash]));
    let record = this.microcodes.get(fingerprint);
    if (!record) {
      record = {
        ...identification,
        fingerprint, fingerprintScope: identity.scope, codeHash, dataHash,
        codeBytes: image.code.length, dataBytes: image.data.length,
        tasks: 0,
        ...(this.classifications ? { classifications: new Map() } : {}),
      };
      this.microcodes.set(fingerprint, record);
    }
    record.tasks++;
    if (this.classifications) {
      // A structural fingerprint can omit constants or unreachable bytes that
      // the reviewed identity protects. Keep EVERY observed outcome and count.
      const key = JSON.stringify(classification);
      const previous = record.classifications.get(key);
      if (previous) previous.tasks++;
      else record.classifications.set(key, { ...structuredClone(classification), tasks: 1 });
    }
  }

  snapshot() {
    const microcodes = [...this.microcodes.values()];
    return { version: this.classifications ? 2 : 1, scope: 'task-start', tasks: this.tasks,
      microcodes: this.classifications ? microcodes.map(record => ({ ...record,
        classifications: structuredClone([...record.classifications.values()]),
      })) : microcodes };
  }
}
