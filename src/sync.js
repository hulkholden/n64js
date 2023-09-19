/*global n64js*/
/*jshint browser:true, devel:true */

import { toString32 } from './format.js';

export let syncFlow = null;
export let syncInput = null;

export function initSync() {
  syncFlow = undefined; // new SyncReader();
  syncInput = undefined; // new SyncReader();
}

export function syncActive() {
  return (syncFlow || syncInput) ? true : false;
}

export function syncTick(maxCount) {
  const kEstimatedBytePerCycle = 8;
  let maxSafeCount = maxCount;

  for (let s of [syncFlow, syncInput]) {
    if (!s) {
      continue;
    }
  
    if (!s.tick()) {
      maxSafeCount = 0;
    }

    // Guesstimate num bytes used per cycle
    let count = Math.floor(s.getAvailableBytes() / kEstimatedBytePerCycle);
    // Ugh - bodgy hacky hacky for input sync
    count = Math.max(0, count - 100);
    maxSafeCount = Math.min(maxSafeCount, count);
  }

  return maxSafeCount;
}

class BinaryRequest {
  constructor(getOrPost, url, args, data, cb) {
    getOrPost = getOrPost || 'GET';

    this.alwaysCallbacks = [];

    if (args) {
      let argStr = '';
      for (let i in args) {
        if (Object.prototype.hasOwnProperty.call(args, i)) {
          if (argStr) {
            argStr += '&';
          }
          argStr += escape(i);
          if (args[i] !== undefined) {
            argStr += '=' + escape(args[i]);
          }
        }
      }

      url += '?' + argStr;
    }

    const xhr = new XMLHttpRequest();
    this.xhr = xhr;

    xhr.open(getOrPost, url, true);
    xhr.responseType = "arraybuffer";

    const that = this;
    xhr.addEventListener('readystatechange', (event) => {
      if (xhr.readyState === 4) {
        that.invokeCallbacks();
      }
    });

    xhr.addEventListener('load', (event) => {
      if (ArrayBuffer.prototype.isPrototypeOf(xhr.response)) {
        cb(xhr.response);
      } else {
        alert("wasn't arraybuffer, was " + typeof (xhr.response) + JSON.stringify(xhr.response));
      }
    });
    xhr.send(data);
  }

  invokeCallbacks() {
    for (let callback of this.alwaysCallbacks) {
      callback();
    }
  }

  always(callback) {
    // If the request has already completed then ensure the callback is called.
    if (this.xhr.readyState === 4) {
      callback();
    }
    this.alwaysCallbacks.push(callback);
    return this;
  }
}

class SyncReader {
  constructor() {
    this.kBufferLength = 1024 * 1024;
    this.syncBuffer = null;
    this.syncBufferIdx = 0;
    this.fileOffset = 0;
    this.curRequest = null;
    this.oos = false;

    this.nextBuffer = null;
  }

  refill() {
    if (!this.syncBuffer || this.syncBufferIdx >= this.syncBuffer.length) {
      this.syncBuffer = this.nextBuffer;
      this.syncBufferIdx = 0;
      this.nextBuffer = null;
    }
  }

  tick() {
    this.refill();

    if (!this.nextBuffer && !this.curRequest) {
      const that = this;

      this.curRequest = new BinaryRequest('GET', "rsynclog", { o: this.fileOffset, l: this.kBufferLength }, undefined, (result) => {
        that.nextBuffer = new Uint32Array(result);
        that.fileOffset += result.byteLength;
      }).always(function () {
        that.curRequest = null;
      });

      return false;
    }
    return true;
  }

  getAvailableBytes() {
    let ops = 0;
    if (this.syncBuffer) {
      ops += this.syncBuffer.length - this.syncBufferIdx;
    }
    if (this.nextBuffer) {
      ops += this.nextBuffer.length;
    }
    return ops * 4;
  }

  pop() {
    if (!this.syncBuffer || this.syncBufferIdx >= this.syncBuffer.length) {
      this.refill();
    }

    if (this.syncBuffer && this.syncBufferIdx < this.syncBuffer.length) {
      const r = this.syncBuffer[this.syncBufferIdx];
      this.syncBufferIdx++;
      return r;
    }
    return -1;
  }

  sync32(val, name) {
    if (this.oos) {
      return false;
    }

    const other = this.pop();
    if (val !== other) {
      n64js.warn(name + ' mismatch: local ' + toString32(val) + ' remote ' + toString32(other));
      // Flag that we're out of sync so that we don't keep spamming errors.
      this.oos = true;
      return false;
    }

    return true;
  }

  reflect32(val) {
    if (this.oos) {
      return val;
    }
    // Ignore val, just return the recorded value from the stream.
    return this.pop();
  }
}

class SyncWriter {
  constructor() {
    this.kBufferLength = 1024 * 1024 / 4;
    this.syncBuffer = new Uint32Array(this.kBufferLength);
    this.syncBufferIdx = 0;

    this.fileOffset = 0;
    this.curRequest = null;
    this.buffers = [];
  }

  flushBuffer() {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.buffers.push(this.syncBuffer);
      this.syncBuffer = new Uint32Array(this.kBufferLength);
      this.syncBufferIdx = 0;
    }
  }

  tick() {
    if (!this.curRequest && this.syncBufferIdx > 0) {
      const b = new Uint32Array(this.syncBufferIdx);
      for (let i = 0; i < this.syncBufferIdx; ++i) {
        b[i] = this.syncBuffer[i];
      }
      this.buffers.push(b);
      this.syncBuffer = new Uint32Array(this.kBufferLength);
      this.syncBufferIdx = 0;
    }
    // If no request is active and we have more buffers to flush, kick off the next upload.
    if (!this.curRequest && this.buffers.length > 0) {
      const buffer = this.buffers[0];
      this.buffers.splice(0, 1);

      const that = this;
      const bytes = buffer.length * 4;
      this.curRequest = new BinaryRequest('POST', "wsynclog", { o: this.fileOffset, l: bytes }, buffer, (result) => {
        that.fileOffset += bytes;
      }).always(function () {
        that.curRequest = null;
      });
    }

    return this.buffers.length === 0;
  }

  getAvailableBytes() {
    // NB we can always handle full buffers, so return a large number here.
    return 1000000000;
  }

  sync32(val, name) {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.flushBuffer();
    }

    this.syncBuffer[this.syncBufferIdx] = val;
    this.syncBufferIdx++;
    return true;
  }

  reflect32(val) {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.flushBuffer();
    }

    this.syncBuffer[this.syncBufferIdx] = val;
    this.syncBufferIdx++;
    return val;
  }
}
