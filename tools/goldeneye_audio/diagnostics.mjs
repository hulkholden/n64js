// Installed only in diagnostic runs; never used in throughput measurements.
export function installDiagnostics() {
  const n = window.n64js, h = n.hardware(), r = h.rsp, sp = h.spRegDevice;
  const stats = window.audioStats = { tasks: 0, streamedTasks: 0, acceleratedTasks: 0, blocks: 0, rspInstructions: 0, xbusReads: 0 };
  const trace = window.audioTrace = [];
  let active = false, accelerated = false;
  const pcmBuffers = [];
  window.audioPCMHash = async () => {
    const size = pcmBuffers.reduce((n, b) => n + b.length, 0), bytes = new Uint8Array(size);
    let offset = 0;
    for (const buffer of pcmBuffers) { bytes.set(buffer, offset); offset += buffer.length; }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return { bytes: size, sha256: Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') };
  };
  const signature = bytes => {
    let a = 0x811c9dc5, b = 0;
    for (const byte of bytes) { a = Math.imul(a ^ byte, 0x1000193) >>> 0; b = (Math.imul(b, 65599) + byte) >>> 0; }
    return [a, b];
  };
  const record = (kind, ...data) => trace.push([kind, h.verticalBlankCount, n.cpu0.controlCountValue, n.cpu0.fragmentOps, ...data]);
  h.onAudioTask = () => {
    active = true; accelerated = false; stats.tasks++;
    record('task', ...signature(h.sp_mem.u8.subarray(0xfc0)));
  };
  const op = r.executeOp;
  r.executeOp = function (word) { if (active) { stats.rspInstructions++; } return op.call(this, word); };
  const set = r.setAudioHLE;
  if (set) {
    r.setAudioHLE = function (executor) {
      if (executor) {
        stats.streamedTasks++;
        const execute = executor.execute;
        executor.execute = function () {
          stats.blocks++;
          if (!accelerated) { accelerated = true; stats.acceleratedTasks++; }
          return execute.call(this);
        };
      }
      return set.call(this, executor);
    };
  }
  for (const method of ['spCopyFromRDRAM', 'spCopyToRDRAM']) {
    const original = sp[method];
    sp[method] = function (dmem, address, length) {
      const size = ((length & 4095) | 7) + 1;
      if (active && method === 'spCopyFromRDRAM') { record('read', r.pc, dmem, address, length, ...signature(h.ram.u8.subarray(address, address + size))); }
      const result = original.call(this, dmem, address, length);
      if (active && method === 'spCopyToRDRAM') { record('write', r.pc, dmem, address, length, ...signature(h.ram.u8.subarray(address, address + size))); }
      return result;
    };
  }
  const status = sp.setStatusBits;
  sp.setStatusBits = function (bits) {
    if (active) {
      record('status', bits, r.pc);
      if (bits & 2) { record('complete', ...signature(h.sp_mem.u8)); active = false; }
    }
    return status.call(this, bits);
  };
  const processBuffer = h.dpcDevice.processBuffer;
  h.dpcDevice.processBuffer = function () {
    if (this.xbusDmemDMA && !(this.statusReg & 2) && this.currentReg !== this.endReg) { stats.xbusReads++; }
    return processBuffer.call(this);
  };
  const playback = h.aiRegDevice.startPlayback;
  h.aiRegDevice.startPlayback = function () {
    const address = this.dmaAddresses[0], length = this.dmaLengths[0];
    pcmBuffers.push(h.ram.u8.slice(address, address + length));
    record('pcm', address, length, ...signature(h.ram.u8.subarray(address, address + length)));
    return playback.call(this);
  };
}
