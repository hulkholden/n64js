import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
// Diagnostic instrumentation for this prototype; never use for throughput timings.
// Run against a scratch source tree prepared by prepare.py.
const [root, rom, output, ...options] = process.argv.slice(2);
const seed = Number(options.find(option => option.startsWith('--seed='))?.slice(7) ?? 166);
if (!root || !rom || !output || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || options.some(option => option !== '--guarded-ram-stores' && !option.startsWith('--seed='))) {
  throw new Error('Usage: bun capture.mjs <prepared-root> <rom> <output-dir> [--guarded-ram-stores] [--seed=166]');
}
const { createHeadlessEmulator, loadROMFile, runFrames } = await import(`${root}/src/headless/headless_env.js`);
const { getPerformanceProfile, performanceProfileDelta, setPerformanceProfiling } = await import(`${root}/src/debug/performance_profile.js`);
const log = console.log;
console.log = () => {};
console.warn = () => {};
let compileMs = 0;
let phase = 'warmup';
const records = [];
const guards = [];
globalThis.__codegenMs = 0;
globalThis.__instrumentationMs = 0;
globalThis.__guard = (id, hit) => { const g = guards[id]; g.calls++; if (hit) g.hits++; return hit; };
const NativeFunction = Function;
globalThis.__compileFragment = (...args) => {
    const target = NativeFunction;
    const newTarget = NativeFunction;
    let source = args.at(-1);
    const match = /return function fragment_(0x[0-9a-f]+)_(\d+)\(/.exec(source);
    if (!match) return Reflect.construct(target, args, newTarget);
    const recordStart = performance.now();
    const compileStart = performance.now();
    const original = Reflect.construct(target, args, newTarget);
    const compileDuration = performance.now() - compileStart;
    compileMs += compileDuration;
    const record = { pc:match[1], ops:Number(match[2]), bytes:Buffer.byteLength(source), phase, source };
    records.push(record);
    source = source.replace(/^  if \((.*ramStoreDV\.byteLength.*)\) \{/gm, (_, condition) => {
      const id = guards.length;
      guards.push({ id, pc:record.pc, calls:0, hits:0 });
      return `  if (globalThis.__guard(${id}, ${condition})) {`;
    });
    const fn = source === args.at(-1) ? original : Reflect.construct(target, [...args.slice(0,-1),source], newTarget);
    globalThis.__instrumentationMs += performance.now() - recordStart - compileDuration;
    return fn;
};
if (options.includes('--guarded-ram-stores')) { const { recompilerOptions } = await import(`${root}/src/options.js`); recompilerOptions.guardedRAMStores = true; }
const loaded = await loadROMFile(rom);
const emulator = await createHeadlessEmulator(loaded);
const { createRandom } = await import(`${root}/src/inventory/inventory_input.js`);
const random = createRandom(seed);
let randomReads = 0;
emulator.cpu0.setRandomSource(() => { randomReads++; return random(); });
setPerformanceProfiling(true);
emulator.hardware.rsp.setPerformanceProfiling(true);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashArray = array => hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
function state() {
 const c=emulator.cpu0, h=emulator.hardware;
 const events=[];
 for (let e=c.eventQueue.firstEvent; e; e=e.next) events.push([e.type,c.getCyclesUntilEvent(e.type)]);
 return { pc:c.pc, nextPC:c.nextPC, delayPC:c.delayPC, branchTarget:c.branchTarget,
   count:c.controlCountValue, ops:c.opsExecuted, randomReads, events, llBit:c.llBit, lastControlRegWrite:c.lastControlRegWrite.toString(), hi:hashArray(c.multHiU32), lo:hashArray(c.multLoU32),
   gpr:hashArray(c.gprU32), cop0:hashArray(c.controlRegU32), fpr:hashArray(h.cpu1.regU32), fcsr:hashArray(h.cpu1.control),
   ram:hash(h.ram.u8), rspPC:h.rsp.pc, rspDelayPC:h.rsp.delayPC, rspGpr:hashArray(h.rsp.gprU32),
   rspVpr:hashArray(h.rsp.vprU32), rspAcc:hashArray(h.rsp.vAccU32), rspVco:hashArray(h.rsp.vuVCOReg), rspVcc:hashArray(h.rsp.vuVCCReg), rspVce:hashArray(h.rsp.vuVCEReg), rspDiv:[h.rsp.divDP,h.rsp.divIn,h.rsp.divOut], spMem:hash(h.sp_mem.u8), spReg:hash(h.sp_reg.u8), mi:hash(h.mi_reg.u8), vi:hash(h.vi_reg.u8),
   ai:hash(h.ai_reg.u8), pi:hash(h.pi_reg.u8), si:hash(h.si_reg.u8),
   fatal:emulator.fatalError(),
 };
}
function totals() {return {calls:guards.reduce((n,g)=>n+g.calls,0),hits:guards.reduce((n,g)=>n+g.hits,0),codegenMs:globalThis.__codegenMs,compileMs,fragments:records.length,bytes:records.reduce((n,r)=>n+r.bytes,0)};}
const windows=[];
runFrames(emulator,120,5_000_000_000);
for (const name of ['early','later']) {
 phase=name;
 const before=totals(), startProfile=getPerformanceProfile();
 const guardBefore=guards.map(g=>({calls:g.calls,hits:g.hits}));
 runFrames(emulator,600,5_000_000_000);
 const after=totals();
 if (after.fragments-before.fragments !== performanceProfileDelta(startProfile).fragmentCompilations) throw new Error('missed fragment captures');
 const perGroup=guards.map((g,i)=>({...g,calls:g.calls-(guardBefore[i]?.calls??0),hits:g.hits-(guardBefore[i]?.hits??0)})).filter(g=>g.calls);
 windows.push({name,endVI:emulator.hardware.verticalBlankCount,totals:after,delta:Object.fromEntries(Object.keys(before).map(k=>[k,after[k]-before[k]])),profile:performanceProfileDelta(startProfile),state:state(),groups:perGroup.sort((a,b)=>b.calls-a.calls)});
 if(name==='early') {phase='advance';runFrames(emulator,600,5_000_000_000);}
}
mkdirSync(output,{recursive:true});
writeFileSync(`${output}/profile.json`,JSON.stringify({seed,rom:loaded.rominfo,romSha256:hash(new Uint8Array(loaded.romBuffer)),runtime:{bun:Bun.version,platform:process.platform,arch:process.arch},windows,fragments:records.map(({source,...r})=>r)},null,2));
const pcs=['0x800afae4','0x80196570',...windows.flatMap(w=>w.groups.slice(0,3).map(g=>g.pc))];
for(const pc of new Set(pcs)) {
 const source=records.findLast(r=>r.pc===pc)?.source;
 if(source) writeFileSync(`${output}/${pc}.js`,source);
}
log(JSON.stringify({rom:loaded.rominfo.name,windows:windows.map(({name,delta,state})=>({name,delta,pc:state.pc,ram:state.ram}))}));
