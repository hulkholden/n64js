// Private ROM input only: no commercial executable or sample data is saved.
import { createHeadlessEmulator, loadROMFile } from '../../src/headless/headless_env.js';
import { GoldenEyeAudioStream } from '../../src/hle/audio_goldeneye_stream.js';
import { RSP } from '../../src/rsp/rsp.js';
import { writeFileSync } from 'node:fs';

const [rom, output] = process.argv.slice(2);
if (!output) { throw new Error('Usage: bun tools/goldeneye_audio/verify.mjs ROM OUTPUT.json'); }
const counts = { resample: 0, envelope: 0, tasks: 0 };
function snapshot(r) {
  return { gpr: r.gprU32.slice(), vec: r.vprU32.slice(), acc: r.vAccU32.slice(), mem: r.hardware.sp_mem.u8.slice(),
    pc: r.pc, delayPC: r.delayPC, nextPC: r.nextPC, branchTarget: r.branchTarget, VCO: r.VCO, VCC: r.VCC, VCE: r.VCE };
}
function restore(r, s) {
  r.gprU32.set(s.gpr); r.vprU32.set(s.vec); r.vAccU32.set(s.acc); r.hardware.sp_mem.u8.set(s.mem);
  for (const k of ['pc', 'delayPC', 'nextPC', 'branchTarget', 'VCO', 'VCC', 'VCE']) { r[k] = s[k]; }
}
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const execute = GoldenEyeAudioStream.prototype.execute;
GoldenEyeAudioStream.prototype.execute = function () {
  const before = snapshot(this.rsp);
  for (let i = 0; i < this.cycles; i++) { RSP.prototype.step.call(this.rsp); }
  const expected = snapshot(this.rsp);
  restore(this.rsp, before);
  execute.call(this);
  const actual = snapshot(this.rsp);
  for (const k of Object.keys(actual)) {
    const same = typeof actual[k] === 'number' ? actual[k] === expected[k] : bytes(actual[k]).equals(bytes(expected[k]));
    if (!same) {
      writeFileSync(output, JSON.stringify({ error: 'DSP mismatch', entry: this.entry, cycles: this.cycles, field: k }, null, 2));
      throw new Error(`DSP mismatch at ${this.entry.toString(16)}: ${k}`);
    }
  }
  counts[this.entry === 0x9d8 ? 'resample' : 'envelope']++;
};
const e = await createHeadlessEmulator(await loadROMFile(rom), { executeGraphics: true });
const h = e.hardware;
let seed = 0x12345678;
e.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
h.onAudioTask = () => { counts.tasks++; };
const run = (frames, buttons = 0) => {
  const target = h.verticalBlankCount + frames;
  e.inputs[0].buttons = buttons;
  h.onVerticalBlank = count => { if (count >= target) { e.cpu0.breakExecution(); } };
  while (h.verticalBlankCount < target && !e.fatalError()) { e.cpu0.run(10_000_000); }
  if (e.fatalError()) { throw new Error(e.fatalError()); }
  console.log(JSON.stringify({ vi: h.verticalBlankCount, ...counts }));
};
for (const step of [[419], [10,4096],[180],[10,4096],[180],[10,4096],[420],[10,4096],[120],
  [10,32768],[90],[10,32768],[90],[10,32768],[90],[10,4096],[120],[240],[10,4096],[180],[180],[15,32768],[180],[540]]) {
  run(...step);
}
writeFileSync(output, JSON.stringify({ vi: h.verticalBlankCount, ...counts, mismatches: 0 }, null, 2) + '\n');
