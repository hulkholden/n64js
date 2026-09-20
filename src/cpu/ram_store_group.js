// A deliberately narrow prototype: consecutive, sequential SW instructions with
// one unchanged base. Each instruction keeps its original PC/exception/event
// bookkeeping and RSP step; only the memory helper is replaced on the RAM path.
// No values are retained across instructions, and no loads are reused.
export class RAMStoreGroup {
  constructor(base) {
    this.base = base;
    this.stores = [];
  }

  canAppend(base, offset, pc) {
    const last = this.stores.at(-1);
    return this.stores.length < 16 && base === this.base && pc === last.pc + 4 &&
      ((offset - last.offset) & 3) === 0;
  }

  add(store) {
    this.stores.push(store);
  }

  finish(fragment) {
    if (this.stores.length < 2) return;
    const start = this.stores[0].start;
    const end = this.stores.at(-1).end;
    const minOffset = Math.min(...this.stores.map(store => store.offset));
    const maxOffset = Math.max(...this.stores.map(store => store.offset));
    const span = maxOffset - minOffset + 4;
    const fallback = fragment.bodyCode.slice(start, end);
    let fast = '';
    let cursor = start;
    for (const store of this.stores) {
      // Replace only the helper statement supplied by generateSW, preserving
      // the surrounding generated instruction and inter-instruction code.
      fast += fragment.bodyCode.slice(cursor, store.end).replace(store.helper,
        `ramStoreDV.setUint32(ramStoreBase + ${store.offset - minOffset}, c.getRegS32Lo(${store.rt}), false);`);
      cursor = store.end;
    }
    // Normalize once at the minimum signed offset. The unwrapped span must fit
    // in BOTH the actual DataView and the cached-RAM mapping (currently 8 MiB).
    // Testing the entire span before any access rejects wraparound, negative
    // physical addresses, and groups straddling the end of RAM. A failed guard
    // runs the original helpers in order, including any partial completion.
    const code = `// Guarded RAM SW group (${this.stores.length} stores)
{
  const ramStoreBase = (c.getRegS32Lo(${this.base}) + ${minOffset} + 0x80000000) >>> 0;
  const ramStoreDV = c.ramDV;
  if ((ramStoreBase & 3) === 0 && ramStoreBase + ${span} <= Math.min(ramStoreDV.byteLength, 0x800000)) {
${fast}
  } else {
${fallback}
  }
}
`;
    fragment.bodyCode = fragment.bodyCode.slice(0, start) + code + fragment.bodyCode.slice(end);
  }
}
