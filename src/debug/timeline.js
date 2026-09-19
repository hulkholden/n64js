/*global n64js*/

const kMaxFrames = 10;
const kMaxEvents = 10000;

export const TrackAudio = 0;
export const TrackDefault = 1;

export class Timeline {
  constructor(getOpsExecuted) {
    this.getOpsExecuted = getOpsExecuted;
    this.recording = false;

    this.tracks = [
      new Track(this, "Default"),
      new Track(this, "Audio"),
    ];

    this.eventCount = 0;

    this.curFrameEvent = 0;
    this.frameCount = 0;
  }

  startRecording() {
    this.recording = true;
    for (let i = 0; i < this.tracks.length; i++) {
      this.tracks[i].reset();
    }
    this.eventCount = 0;
    this.frameCount = 0;
  }

  newFrame() {
    if (!this.recording) {
      return null;
    }

    if (this.curFrameEvent) {
      this.curFrameEvent.stop();
    }
    // Clear the current track event so the frame events are always at the root.
    this.tracks[TrackDefault].curEvent = null;
    this.curFrameEvent = this.startEventInternal(`Frame ${this.frameCount}`, TrackDefault);

    this.frameCount++;
    if (this.eventCount >= kMaxEvents || this.frameCount >= kMaxFrames) {
      this.recording = false;
      this.curFrameEvent = null;
      n64js.debugger().showTimeline();
    }
  }

  addEvent(name, track) {
    if (!this.curFrameEvent) {
      return null;
    }
    const ev = this.startEventInternal(name, track);
    if (ev) {
      ev.stop();
    }
  }

  startEvent(name, track) {
    if (!this.curFrameEvent) {
      return null;
    }
    return this.startEventInternal(name, track);
  }

  startEventInternal(name, opt_track) {
    const trackId = opt_track == undefined ? TrackDefault : opt_track;
    const track = this.tracks[trackId];

    this.eventCount++;
    return track.startEvent(name);
  }
}

class Track {
  constructor(timeline, name) {
    this.timeline = timeline;
    this.name = name;
    this.events = [];
    this.curEvent = null;
  }

  reset() {
    this.events = [];
    this.curEvent = null;
  }

  startEvent(name) {
    const c = this.timeline.getOpsExecuted();
    const e = new Event(this, this.curEvent, name, c);
    this.events.push(e);
    this.curEvent = e;
    return e;
  }

  stopEvent(e) {
    e.end = this.timeline.getOpsExecuted();
    if (this.curEvent == e) {
      this.curEvent = e.parent;
    }
  }
}

class Event {
  constructor(track, parent, name, t) {
    this.track = track;
    this.parent = parent;
    this.depth = parent ? parent.depth + 1 : 0;
    this.name = name;
    this.start = t;
    this.end = t;
  }

  stop() {
    this.track.stopEvent(this);
  }
}
