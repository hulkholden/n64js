// Synthetic runtime isolation: compile once, then execute with the real CPU,
// RAM helpers and stopped RSP. No group building takes place inside the timer.
// bun replay-stores.mjs <checkout> <store-count> [off]
import { createHash } from 'node:crypto';

const [root, countText, off] = process.argv.slice(2);
const count = Number(countText);
if (![2, 4, 10, 16].includes(count)) throw new Error('Expected 2, 4, 10 or 16 stores');
const { createHeadlessEmulator } = await import(`${root}/src/headless/headless_env.js`);
const { Fragment } = await import(`${root}/src/cpu/fragments.js`);
const { FragmentContext, generateCodeForOp, finishCodeGeneration } = await import(`${root}/src/cpu/recompiler.js`);
const { recompilerOptions } = await import(`${root}/src/options.js`);
recompilerOptions.guardedRAMStores = off !== 'off';
const log = console.log;
console.log = () => {};
const { cpu0: c, hardware: h } = await createHeadlessEmulator({
  romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' },
});
const pc = 0x80001000;
const fragment = new Fragment(pc);
const ctx = new FragmentContext();
const words = [0, ...Array.from({ length: count }, (_, i) =>
  ((0x2b << 26) | (29 << 21) | ((i + 2) << 16) | (i * 4)) >>> 0)];
for (let i = 0; i < words.length; i++) {
  fragment.opsCompiled++;
  fragment.bodyCode += `rsp.step();\nif (c.stuffToDo) { c.pc = ${pc + i * 4}; return ${i}; }\n`;
  ctx.set(fragment, pc + i * 4, words[i], pc + i * 4 + 4, pc + i * 4 + 4);
  generateCodeForOp(ctx);
}
finishCodeGeneration(ctx);
const code = `return function storeBurst() {\n${fragment.bodyCode}\nreturn ${words.length};\n}`;
const fn = new Function('c', 'rsp', code)(c, h.rsp);
c.stuffToDo = 0;
c.delayPC = null;
for (let r = 2; r < 18; r++) c.setRegS32Extend(r, r);
let checksum = 0;
function run(iterations) {
  for (let i = 0; i < iterations; i++) {
    c.setRegS32Extend(29, (0x80000000 + (i & 0xffc)) | 0);
    checksum += fn();
  }
}
run(100_000);
const iterations = 5_000_000;
const before = Bun.nanoseconds();
run(iterations);
const seconds = (Bun.nanoseconds() - before) / 1e9;
const ramHash = createHash('sha256').update(h.ram.u8).digest('hex');
log(JSON.stringify({ count, iterations, seconds, nsPerBurst: seconds * 1e9 / iterations,
  sourceBytes: Buffer.byteLength(code), sourceSHA256: createHash('sha256').update(code).digest('hex'),
  checksum, ramHash, pc: c.pc, rspHalted: h.rsp.halted }));
