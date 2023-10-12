export class Timeline {
  constructor(getOpsExecuted) {
    this.getOpsExecuted = getOpsExecuted;
    this.events = [];
    this.recording = false;
  }

  startRecording() {
    this.events = [];
    this.recording = true;
  }

  addEvent(name) {
    if (!this.recording) {
      return null;
    }

    const c = this.getOpsExecuted();
    const e = new Event(this, name, c);
    this.events.push(e);

    if (this.events.length == 100) {
      this.dump();
      this.recording = false;
    }

    return e;
  }

  dump() {
    this.events.forEach(e => {
      console.log(`${e.start}: ${e.name}`);
    });
  }
}

class Event {
  constructor(tl, name, t) {
    this.timeline = tl;
    this.name = name;
    this.start = t;
    this.end = t;
  }

  stop() {
    this.end = this.timeline.getOpsExecuted();
  }
}
