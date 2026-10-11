import { NEADAudio } from './audio_nead.js';

// The Japanese revision adds a loader loop that repeatedly clears the same
// parameter word. Its command handlers are otherwise instruction-equivalent.
export class StarFoxRevisionAudio extends NEADAudio {
  initializeTask(rsp) {
    super.initializeTask(rsp);
    this.view.setUint32(this.parameters, 0);
  }
}
