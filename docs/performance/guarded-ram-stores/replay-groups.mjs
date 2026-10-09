// Replay candidate groups captured by capture-overhead.mjs, without emulation.
// bun replay-groups.mjs <checkout> <corpus.json> [record|emit]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [root, file, mode = 'emit'] = process.argv.slice(2);
if (!['record', 'emit'].includes(mode)) throw new Error('Expected record or emit');
const { RAMStoreGroup } = await import(`${root}/src/cpu/ram_store_group.js`);
const original = !RAMStoreGroup.prototype.reset;
const corpus = JSON.parse(readFileSync(file, 'utf8'));
const scratch = original ? null : new RAMStoreGroup();
const fragment = { bodyCode: '' };
let checksum = 0;
function replay() {
  for (const entry of corpus) {
    const group = original ? new RAMStoreGroup(entry.base) : scratch;
    for (let i = 0; i < entry.stores.length; i++) {
      const s = entry.stores[i];
      if (i && !group.canAppend(entry.base, s.offset, s.pc)) throw new Error('Invalid corpus');
      if (original) {
        group.add({ start: s.start, end: s.end, pc: s.pc, offset: s.offset,
          rt: s.rt, helper: `c.execSW(${s.rt}, ${entry.base}, ${s.offset});` });
      } else {
        group.add(entry.base, s.start, s.end, s.pc, s.offset, s.rt);
      }
    }
    checksum += original ? group.stores.length : group.count;
    if (mode === 'emit') {
      fragment.bodyCode = entry.body;
      group.finish(fragment);
      // Read emitted output so the work has an observable result. This does
      // not include Function construction or execution.
      checksum += fragment.bodyCode.charCodeAt(fragment.bodyCode.length - 1);
    } else if (!original) {
      group.reset();
    }
  }
}
for (let i = 0; i < 20; i++) replay();
const iterations = mode === 'record' ? 1000 : 100;
const before = Bun.nanoseconds();
for (let i = 0; i < iterations; i++) replay();
const seconds = (Bun.nanoseconds() - before) / 1e9;
console.log(JSON.stringify({ mode, original, candidates: corpus.length,
  corpusSHA256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  iterations, seconds, msPerCorpus: 1000 * seconds / iterations, checksum }));
