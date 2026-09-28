import { ABI1Audio } from './audio_abi1.js';

// The captured USA program shares all other handlers and constants with the
// standard ABI1 program. Keep its one functional difference local to this class.
export class TetrisphereAudio extends ABI1Audio {
  mix() {
    // 0x1e24–0x1e6c: loads and a countdown, no arithmetic or sample stores.
  }
}
