// Fresh-process, seeded headless samples for the allocation follow-up.
// bun measure-overhead.mjs <checkout> <rom> [off]
// No profiling or forced GC occurs in the measured windows.
import { createHash } from 'node:crypto';

const [root, rom, off] = process.argv.slice(2);
const { createHeadlessEmulator, loadROMFile, runFrames } = await import(`${root}/src/headless/headless_env.js`);
const { recompilerOptions } = await import(`${root}/src/options.js`);
const { createRandom } = await import(`${root}/src/inventory/inventory_input.js`);
recompilerOptions.guardedRAMStores = off !== 'off';
const log = console.log;
console.log = () => {};
console.warn = () => {};
const loaded = await loadROMFile(rom);
const emulator = await createHeadlessEmulator(loaded);
emulator.cpu0.setRandomSource(createRandom(166));
function state() {
  const c = emulator.cpu0, h = emulator.hardware;
  const hash = createHash('sha256');
  for (const a of [c.gprU32, c.multHiU32, c.multLoU32, c.controlRegU32,
    h.cpu1.regU32, h.cpu1.control, h.ram.u8, h.rsp.gprU32, h.rsp.vprU32,
    h.rsp.vAccU32, h.rsp.vuVCOReg, h.rsp.vuVCCReg, h.rsp.vuVCEReg,
    h.sp_mem.u8, h.sp_reg.u8, h.mi_reg.u8, h.vi_reg.u8, h.ai_reg.u8,
    h.pi_reg.u8, h.si_reg.u8]) {
    hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }
  const events = [];
  for (let e = c.eventQueue.firstEvent; e; e = e.next) events.push([e.type, c.getCyclesUntilEvent(e.type)]);
  hash.update(JSON.stringify([c.pc, c.nextPC, c.delayPC, c.branchTarget,
    c.controlCountValue, c.opsExecuted, c.llBit, c.lastControlRegWrite.toString(),
    h.rsp.pc, h.rsp.delayPC, h.rsp.divDP, h.rsp.divIn, h.rsp.divOut, events]));
  return hash.digest('hex');
}
const windows = [];
runFrames(emulator, 120, 5_000_000_000);
for (const name of ['early', 'later']) {
  const before = emulator.cpu0.getOpsExecuted();
  const start = Bun.nanoseconds();
  runFrames(emulator, 600, 5_000_000_000);
  const seconds = (Bun.nanoseconds() - start) / 1e9;
  if (emulator.fatalError()) throw new Error(emulator.fatalError());
  windows.push({ name, endVI: emulator.hardware.verticalBlankCount, seconds,
    fps: 600 / seconds, cycles: emulator.cpu0.getOpsExecuted() - before, state: state() });
  if (name === 'early') runFrames(emulator, 600, 5_000_000_000);
}
log(JSON.stringify({ seed: 166, bun: Bun.version, name: loaded.rominfo.name, windows }));
