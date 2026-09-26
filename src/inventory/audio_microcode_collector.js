import { createHash } from 'node:crypto';
import { audioMicrocodeIdentity, identifyAudioMicrocode } from '../hle/audio_microcode.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export class AudioMicrocodeCollector {
  constructor() {
    this.tasks = 0;
    this.microcodes = new Map();
  }

  observe(image) {
    this.tasks++;
    const identification = identifyAudioMicrocode(image);
    const identity = audioMicrocodeIdentity(image, identification);
    const codeHash = sha256(identity.code);
    const dataHash = sha256(identity.data);
    // Delimited hashes include both images and their interpretation. A changed
    // image at the same guest address must trigger a fresh classification.
    const fingerprint = sha256(JSON.stringify([identity.scope, image.loader, image.loadAddress, image.issues, codeHash, dataHash]));
    const previous = this.microcodes.get(fingerprint);
    if (previous) {
      previous.tasks++;
      return;
    }
    this.microcodes.set(fingerprint, {
      ...identification,
      fingerprint, fingerprintScope: identity.scope, codeHash, dataHash,
      codeBytes: image.code.length, dataBytes: image.data.length,
      tasks: 1,
    });
  }

  snapshot() {
    return { version: 1, scope: 'task-start', tasks: this.tasks, microcodes: [...this.microcodes.values()] };
  }
}
