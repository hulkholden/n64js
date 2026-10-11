// Diagnostic-only instrumentation. Never use this process for throughput timings.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const [source, rom, output, warmupText = '120'] = process.argv.slice(2);
if (!output) { throw new Error('Usage: bun diagnostic.mjs SOURCE ROM OUTPUT [WARMUP]'); }
const scratch = mkdtempSync(join(tmpdir(), 'n64js-rsp-idle-'));
cpSync(resolve(source, 'src'), join(scratch, 'src'), { recursive: true });
cpSync(resolve(source, 'package.json'), join(scratch, 'package.json'));
symlinkSync(resolve(source, 'node_modules'), join(scratch, 'node_modules'));
const cpuPath = join(scratch, 'src/cpu/r4300.js');
let cpuSource = readFileSync(cpuPath, 'utf8');
cpuSource = cpuSource.replace('function addOpToFragment(fragment, entry_pc, instruction, c) {', `
function addOpToFragment(...args) {
  const start = performance.now();
  try { return addOpToFragmentMeasured(...args); }
  finally { n64js.rspIdleStats.compileMs += performance.now() - start; }
}
function addOpToFragmentMeasured(fragment, entry_pc, instruction, c) {`);
writeFileSync(cpuPath, cpuSource);
const stats = { compileMs: 0, compilations: 0, sourceBytes: 0, guards: 0, hits: 0, steps: 0, haltedSteps: 0, byPC: {} };
const FunctionClass = globalThis.Function;
globalThis.Function = new Proxy(FunctionClass, {
  apply(target, thisArg, args) { return this.construct(target, args); },
  construct(target, args) {
    const original = args.at(-1);
    const match = typeof original === 'string' && original.match(/return function fragment_(0x[0-9a-f]+)_(\d+)\(\) \{/);
    if (match) {
      const pc = match[1];
      stats.compilations++;
      stats.sourceBytes += Buffer.byteLength(original);
      const key = `${pc}-${stats.compilations}`;
      stats.byPC[key] = { pc, runs: 0, source: original };
      args[args.length - 1] = original.replace(match[0], `${match[0]} n64js.rspIdleStats.byPC['${key}'].runs++;`)
        .replace(/if \(!rsp.halted && !c.stuffToDo && c.delayPC === (\d+)\) \{/, 'if ((n64js.rspIdleStats.guards++, !rsp.halted && !c.stuffToDo && c.delayPC === $1)) { n64js.rspIdleStats.hits++;');
    }
    return Reflect.construct(target, args);
  },
});
const { createHeadlessEmulator, loadROMFile, runFrames } = await import(join(scratch, 'src/headless/headless_env.js'));
const { setPerformanceProfiling, getPerformanceProfile } = await import(join(scratch, 'src/debug/performance_profile.js'));
const log = console.log;
console.log = () => {};
console.warn = () => {};
const loaded = await loadROMFile(rom);
const emulator = await createHeadlessEmulator(loaded);
n64js.rspIdleStats = stats;
let seed = 0x12345678;
emulator.cpu0.setRandomSource(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
setPerformanceProfiling(true);
emulator.hardware.rsp.setPerformanceProfiling(true);
const step = emulator.hardware.rsp.step;
emulator.hardware.rsp.step = function () { stats.steps++; if (this.halted) { stats.haltedSteps++; } return step.call(this); };
runFrames(emulator, Number(warmupText), 5e9);
const before = { ...stats, byPC: undefined, profile: getPerformanceProfile() };
runFrames(emulator, 600, 5e9);
const profile = getPerformanceProfile();
const delta = Object.fromEntries(Object.keys(before).filter(k => typeof before[k] === 'number').map(k => [k, stats[k] - before[k]]));
const ordered = Object.entries(stats.byPC).sort((a, b) => b[1].runs - a[1].runs);
const idle = ordered.find(([, data]) => data.source.includes('c.speedHack()') && data.source.match(/fragment_0x[0-9a-f]+_2\(/));
const hottest = [...new Map([...ordered.slice(0, 2), ...(idle ? [idle] : [])]).entries()];
const c = emulator.cpu0, h = emulator.hardware;
const hash = view => createHash('sha256').update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest('hex');
const events = [];
let deadline = c.eventQueue.cyclesToFirstEvent;
for (let event = c.eventQueue.firstEvent; event; event = event.next) { events.push([event.type, deadline]); deadline += event.cyclesToNextEvent; }
const state = {
  cpu: hash(c.gprU32), cop0: hash(c.controlRegU32), fpu: hash(h.cpu1.regU32), fcr: [...h.cpu1.control],
  pc: c.pc, delayPC: c.delayPC, count: c.controlCountValue, ram: hash(h.ram.u8), spmem: hash(h.sp_mem.u8),
  rsp: hash(h.rsp.gprU32), vectors: hash(h.rsp.vprU32), accumulator: hash(h.rsp.vAccU32),
  rspPC: h.rsp.pc, rspDelayPC: h.rsp.delayPC, rspHalted: h.rsp.halted,
  vco: [...h.rsp.vuVCOReg], vcc: [...h.rsp.vuVCCReg], vce: [...h.rsp.vuVCEReg],
  div: [h.rsp.divDP, h.rsp.divIn, h.rsp.divOut], events,
  devices: Object.fromEntries(['sp_reg','mi_reg','pi_reg','si_reg','ai_reg','vi_reg','dpc_mem'].map(k => [k, [...h[k].u8]])),
};
mkdirSync(output, { recursive: true });
for (const [pc, data] of hottest) { writeFileSync(join(output, `${pc}.js.txt`), data.source); }
writeFileSync(join(output, 'diagnostic.json'), JSON.stringify({ state, rom, rominfo: loaded.rominfo, runtime: Bun.version, warmup: Number(warmupText), frames: 600, startup: before, measured: delta, profile: Object.fromEntries(Object.keys(profile).map(k => [k, profile[k] - before.profile[k]])), hottest: hottest.map(([key, data]) => ({ key, pc: data.pc, runs: data.runs, sourceBytes: Buffer.byteLength(data.source) })) }, null, 2) + '\n');
console.log = log;
log(join(output, 'diagnostic.json'));
