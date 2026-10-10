// Cross-check an unrelated streaming-audio title in separate processes.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const [root, rom, framesText, output] = process.argv.slice(2);
if (!output) { throw new Error('Usage: bun tools/goldeneye_audio/smoke.mjs CHECKOUT ROM VIS OUTPUT.json'); }
const { createHeadlessEmulator, loadROMFile } = await import(pathToFileURL(resolve(root, 'src/headless/headless_env.js')));
const identities = {};
const e = await createHeadlessEmulator(await loadROMFile(rom), { executeGraphics: true,
  onAudioTask: info => { identities[info.identity] = (identities[info.identity] ?? 0) + 1; } });
const h = e.hardware, r = h.rsp;
let seed = 0x12345678;
e.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
const pcm = createHash('sha256'), playback = h.aiRegDevice.startPlayback;
h.aiRegDevice.startPlayback = function () {
  pcm.update(h.ram.u8.subarray(this.dmaAddresses[0], this.dmaAddresses[0] + this.dmaLengths[0]));
  return playback.call(this);
};
const frames = Number(framesText);
h.onVerticalBlank = vi => { if (vi >= frames) { e.cpu0.breakExecution(); } };
while (h.verticalBlankCount < frames && !e.fatalError()) { e.cpu0.run(10_000_000); }
if (e.fatalError()) { throw new Error(e.fatalError()); }
r.synchronizeAudioHLE?.();
const digest = view => createHash('sha256').update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest('hex');
const events = [];
let deadline = e.cpu0.eventQueue.cyclesToFirstEvent;
for (let event = e.cpu0.eventQueue.firstEvent; event; event = event.next) {
  events.push([event.type, deadline]); deadline += event.cyclesToNextEvent;
}
const state = { vi: h.verticalBlankCount, identities, pcm: pcm.digest('hex'), events,
  count: e.cpu0.controlCountValue, pc: e.cpu0.pc, delayPC: e.cpu0.delayPC,
  cpu: digest(e.cpu0.gprU32), cop0: digest(e.cpu0.controlRegU32), fpu: digest(h.cpu1.regU32),
  ram: digest(h.ram.u8), spmem: digest(h.sp_mem.u8), rsp: digest(r.gprU32), vectors: digest(r.vprU32), acc: digest(r.vAccU32),
  rspPC: r.pc, rspDelayPC: r.delayPC, halted: r.halted, vco: r.VCO, vcc: r.VCC, vce: r.VCE,
  devices: Object.fromEntries(['sp_reg','mi_reg','pi_reg','si_reg','ai_reg','vi_reg','dpc_mem'].map(k => [k, [...h[k].u8]])) };
writeFileSync(output, JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify({ vi: state.vi, identities, pcm: state.pcm }));
