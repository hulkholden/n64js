// A deliberately narrow prototype: consecutive, sequential SW instructions with
// one unchanged base. Each instruction keeps its original PC/exception/event
// bookkeeping and RSP step; only the memory helper is replaced on the RAM path.
// No values are retained across instructions, and no loads are reused.
export class RAMStoreGroup {
  constructor() {
    // The production compiler reuses one FragmentContext. Keep its bounded
    // scratch buffers across groups and fragments; retain no generated strings.
    this.ends = new Uint32Array(16);
    this.offsets = new Int32Array(16);
    this.registers = new Uint8Array(16);
    this.count = 0;
    this.base = 0;
    this.start = 0;
    this.lastPC = 0;
    this.lastOffset = 0;
    this.minOffset = 0;
    this.maxOffset = 0;
  }

  reset() {
    // Entries beyond count are dead. add() overwrites the scalar bounds on the
    // first store, so clearing the buffers or other fields would be wasted work.
    this.count = 0;
  }

  canAppend(base, offset, pc) {
    return this.count < this.ends.length && base === this.base && pc === this.lastPC + 4 &&
      ((offset - this.lastOffset) & 3) === 0;
  }

  add(base, start, end, pc, offset, rt) {
    if (this.count === 0) {
      this.base = base;
      this.start = start;
      this.minOffset = offset;
      this.maxOffset = offset;
    } else {
      this.minOffset = Math.min(this.minOffset, offset);
      this.maxOffset = Math.max(this.maxOffset, offset);
    }
    this.ends[this.count] = end;
    this.offsets[this.count] = offset;
    this.registers[this.count] = rt;
    this.lastPC = pc;
    this.lastOffset = offset;
    this.count++;
  }

  finish(fragment) {
    if (this.count < 2) {
      this.reset();
      return;
    }
    const start = this.start;
    const end = this.ends[this.count - 1];
    const minOffset = this.minOffset;
    const span = this.maxOffset - minOffset + 4;
    const fallback = fragment.bodyCode.slice(start, end);
    let fast = '';
    let cursor = start;
    for (let i = 0; i < this.count; ++i) {
      // Replace only the ordinary SW helper statement, preserving
      // the surrounding generated instruction and inter-instruction code.
      const offset = this.offsets[i];
      const rt = this.registers[i];
      fast += fragment.bodyCode.slice(cursor, this.ends[i]).replace(`c.execSW(${rt}, ${this.base}, ${offset});`,
        `ramStoreDV.setUint32(ramStoreBase + ${offset - minOffset}, c.getRegS32Lo(${rt}), false);`);
      cursor = this.ends[i];
    }
    // Normalize once at the minimum signed offset. The unwrapped span must fit
    // in BOTH the actual DataView and the cached-RAM mapping (currently 8 MiB).
    // Testing the entire span before any access rejects wraparound, negative
    // physical addresses, and groups straddling the end of RAM. A failed guard
    // runs the original helpers in order, including any partial completion.
    const code = `// Guarded RAM SW group (${this.count} stores)
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
    this.reset();
  }
}
