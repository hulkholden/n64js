// Audio microcode detection is not implemented yet. Keep the task-start
// observation path in place while reporting every audio microcode as unknown.
export function identifyAudioMicrocode() {
  return { family: 'Unknown', detection: 'unknown' };
}
