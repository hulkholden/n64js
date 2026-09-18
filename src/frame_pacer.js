// Browser display callbacks need not match the emulated VI rate. Accumulate
// elapsed time so late callbacks can catch up and fast displays can wait.
const kMaxFramesPerUpdate = 3;

export class FramePacer {
  constructor() {
    this.reset();
  }

  reset() {
    this.lastTime = null;
    this.pendingFrames = 0;
  }

  framesDue(now, refreshRate) {
    if (this.lastTime === null) {
      this.lastTime = now;
      return 1;
    }
    this.pendingFrames += Math.max(0, now - this.lastTime) * refreshRate / 1000;
    this.lastTime = now;
    // Allow for floating point error at exact frame boundaries.
    const frames = Math.floor(this.pendingFrames + 1e-9);
    this.pendingFrames = Math.max(0, this.pendingFrames - frames);
    // Discard excess backlog after a long stall (e.g. a background tab), rather
    // than spending subsequent callbacks replaying seconds of missed frames.
    return Math.min(frames, kMaxFramesPerUpdate);
  }
}
