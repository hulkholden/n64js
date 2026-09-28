import { audioMicrocodeInfo, classifyAudioTask } from './hle_audio.js';

// Preserve the observer's compact legacy shape for unknown tasks.
export function identifyAudioMicrocode(hardware) {
  return audioMicrocodeInfo(classifyAudioTask(hardware));
}
