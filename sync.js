/*jshint browser:true, devel:true */

(function (n64js) {'use strict';

  function BinaryRequest(get_or_post, url, args, data, cb) {
    get_or_post = get_or_post || 'GET';

    var alwaysCallbacks = [];

    if (args) {
      var arg_str = '';
      var i;
      for (i in args) {
        if (args.hasOwnProperty(i)) {
          if (arg_str) {
            arg_str += '&';
          }
          arg_str += escape(i);
          if (args[i] !== undefined) {
            arg_str += '=' + escape(args[i]);
          }
        }
      }

      url += '?' + arg_str;
    }

    function invokeAlways() {
      var i;
      for (i = 0; i < alwaysCallbacks.length; ++i) {
        alwaysCallbacks[i]();
      }
    }

    var xhr = new XMLHttpRequest();
    xhr.open(get_or_post, url, true);
    try {
      xhr.responseType = "arraybuffer";
    } catch (e) {
      alert('responseType arrayBuffer not supported!');
    }
    xhr.onreadystatechange = function onreadystatechange () {
      if(xhr.readyState === 4) {
        invokeAlways();
      }
    };
    xhr.onload = function onload() {
      if (ArrayBuffer.prototype.isPrototypeOf(this.response)) {
        cb(this.response);
      } else {
        alert("wasn't arraybuffer, was " + typeof(this.response) + JSON.stringify(this.response));
      }
    };
    xhr.send(data);


    this.always = function (cb) {
      // If the request has already completed then ensure the callback is called.
      if(xhr.readyState === 4) {
        cb();
      }
      alwaysCallbacks.push(cb);
      return this;
    };
  }


  function SyncReader() {
    this.kBufferLength = 1024*1024;
    this.syncBuffer    = null;
    this.syncBufferIdx = 0;
    this.fileOffset    = 0;
    this.curRequest    = null;
    this.oos           = false;

    this.nextBuffer    = null;
  }

  SyncReader.prototype.refill = function () {
    if (!this.syncBuffer || this.syncBufferIdx >= this.syncBuffer.length) {
      this.syncBuffer    = this.nextBuffer;
      this.syncBufferIdx = 0;
      this.nextBuffer    = null;
    }
  };

  SyncReader.prototype.tick = function () {

    this.refill();

    if (!this.nextBuffer && !this.curRequest) {
      var that = this;

      this.curRequest = new BinaryRequest('GET', "rsynclog", {o:this.fileOffset,l:this.kBufferLength}, undefined, function (result){
        that.nextBuffer     = new Uint32Array(result);
        that.fileOffset     += result.byteLength;
      }).always(function () {
        that.curRequest = null;
      });

      return false;
    }

    return true;
  };

  SyncReader.prototype.getAvailableBytes = function () {
    var ops = 0;
    if (this.syncBuffer) {
      ops += this.syncBuffer.length - this.syncBufferIdx;
    }
    if (this.nextBuffer) {
      ops += this.nextBuffer.length;
    }

    return ops * 4;
  };

  SyncReader.prototype.pop = function () {
    if (!this.syncBuffer || this.syncBufferIdx >= this.syncBuffer.length) {
      this.refill();
    }

    if (this.syncBuffer && this.syncBufferIdx < this.syncBuffer.length) {
      var r = this.syncBuffer[this.syncBufferIdx];
      this.syncBufferIdx++;
      return r;
    }
    return -1;
  };

  SyncReader.prototype.sync32 = function (val, name) {

    if (this.oos) {
      return false;
    }

    var other = this.pop();
    if (val !== other) {
      n64js.warn(name + ' mismatch: local ' + n64js.toString32(val) + ' remote ' + n64js.toString32(other));
      // Flag that we're out of sync so that we don't keep spamming errors.
      this.oos = true;
      return false;
    }

    return true;
  };

  SyncReader.prototype.reflect32 = function (val) {
    if (this.oos) {
      return val;
    }
    // Ignore val, just return the recorded value from the stream.
    return this.pop();
  };



  function SyncWriter() {
    this.kBufferLength  = 1024*1024/4;
    this.syncBuffer    = new Uint32Array(this.kBufferLength);
    this.syncBufferIdx = 0;


    this.fileOffset     = 0;
    this.curRequest     = null;
    this.buffers        = [];
  }

  SyncWriter.prototype.flushBuffer = function () {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.buffers.push(this.syncBuffer);
      this.syncBuffer    = new Uint32Array(this.kBufferLength);
      this.syncBufferIdx = 0;
    }
  };

  SyncWriter.prototype.tick = function () {

    if (!this.curRequest && this.syncBufferIdx > 0) {

      var b = new Uint32Array(this.syncBufferIdx);
      for (var i = 0; i < this.syncBufferIdx; ++i) {
        b[i] = this.syncBuffer[i];
      }
      this.buffers.push(b);
      this.syncBuffer    = new Uint32Array(this.kBufferLength);
      this.syncBufferIdx = 0;
    }
    // If no request is active and we have more buffers to flush, kick off the next upload.
    if (!this.curRequest && this.buffers.length > 0) {

      var buffer = this.buffers[0];
      this.buffers.splice(0,1);

      var that = this;
      var bytes = buffer.length * 4;
      this.curRequest = new BinaryRequest('POST', "wsynclog", {o:this.fileOffset,l:bytes}, buffer, function (result) {
        that.fileOffset += bytes;
      }).always(function () {
        that.curRequest = null;
      });
    }

    return this.buffers.length === 0;
  };

  SyncWriter.prototype.getAvailableBytes = function () {
    // NB we can always handle full buffers, so return a large number here.
    return 1000000000;
  };

  SyncWriter.prototype.sync32 = function (val, name) {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.flushBuffer();
    }

    this.syncBuffer[this.syncBufferIdx] = val;
    this.syncBufferIdx++;
    return true;
  };

  SyncWriter.prototype.reflect32 = function (val) {
    if (this.syncBufferIdx >= this.syncBuffer.length) {
      this.flushBuffer();
    }

    this.syncBuffer[this.syncBufferIdx] = val;
    this.syncBufferIdx++;
    return val;
  };

  n64js.createSyncConsumer = function () { return new SyncReader(); };
  n64js.createSyncProducer = function () { return new SyncWriter(); };

}(window.n64js = window.n64js || {}));
