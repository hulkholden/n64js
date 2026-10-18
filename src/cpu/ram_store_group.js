import { disassembleInstruction } from './disassemble.js';
import { toString32 } from '../format.js';

function gprS32Lo(reg) {
  return reg === 0 ? '0' : `c.gprS32[${reg * 2}]`;
}

// Groups consecutive, sequential SW instructions with an unchanged base. On a
// proven cached-RAM hit, stores write directly to the big-endian DataView using
// direct GPR array reads and omit per-store exception and MMIO-interrupt
// bookkeeping while keeping inter-instruction RSP steps. A failed guard runs
// the original per-instruction helpers and bookkeeping in order.
export class RAMStoreGroup {
  constructor() {
    // The production compiler reuses one FragmentContext. Keep its bounded
    // scratch buffers across groups and fragments; retain no generated strings.
    this.pcs = new Uint32Array(16);
    this.opsBefore = new Uint16Array(16);
    this.instructions = new Uint32Array(16);
    this.offsets = new Int32Array(16);
    this.registers = new Uint8Array(16);
    this.count = 0;
    this.base = 0;
    this.lastPC = 0;
    this.lastOffset = 0;
    this.minOffset = 0;
    this.maxOffset = 0;
    this.includeStepPreamble = false;
  }

  reset() {
    // Entries beyond count are dead. add() overwrites the scalar bounds on the
    // first store, so clearing the buffers or other fields would be wasted work.
    this.count = 0;
  }

  canAppend(base, offset, pc) {
    return this.count < this.pcs.length && base === this.base && pc === this.lastPC + 4 &&
      ((offset - this.lastOffset) & 3) === 0;
  }

  add(ctx, includeStepPreamble = false) {
    const base = ctx.instr_base();
    const offset = ctx.instr_imms();
    const rt = ctx.instr_rt();
    if (this.count === 0) {
      this.base = base;
      this.minOffset = offset;
      this.maxOffset = offset;
      this.includeStepPreamble = includeStepPreamble;
    } else {
      this.minOffset = Math.min(this.minOffset, offset);
      this.maxOffset = Math.max(this.maxOffset, offset);
    }
    this.pcs[this.count] = ctx.pc;
    this.opsBefore[this.count] = ctx.fragment.opsCompiled - 1;
    this.instructions[this.count] = ctx.instruction >>> 0;
    this.offsets[this.count] = offset;
    this.registers[this.count] = rt;
    this.lastPC = ctx.pc;
    this.lastOffset = offset;
    this.count++;
  }

  emitStoreBlock(ctx, i, includeComment = true) {
    const pc = this.pcs[i];
    const opsBefore = this.opsBefore[i];
    const offset = this.offsets[i];
    const rt = this.registers[i];
    const comment = includeComment
      ? `// ${disassembleInstruction(pc, this.instructions[i], false).disassembly}\n`
      : '';
    return `${comment}{\n` +
      `  ${ctx.genSetFragmentOps(opsBefore)}\n` +
      `  c.nextPC = ${toString32(pc + 4)};\n` +
      `  c.execSW(${rt}, ${this.base}, ${offset});\n` +
      `  c.pc = c.nextPC;\n` +
      `  c.delayPC = null;\n` +
      `  if (c.stuffToDo) { ${ctx.genReturnOps(opsBefore + 1)} }\n` +
      `}\n\n`;
  }

  finish(ctx) {
    if (this.count === 0) {
      return;
    }
    if (this.count === 1) {
      ctx.fragment.bodyCode += this.emitStoreBlock(ctx, 0, true);
      this.reset();
      return;
    }
    const minOffset = this.minOffset;
    const span = this.maxOffset - minOffset + 4;
    let fast = '';
    let slow = '';
    for (let i = 0; i < this.count; ++i) {
      const pc = this.pcs[i];
      const opsBefore = this.opsBefore[i];
      const offset = this.offsets[i];
      const rt = this.registers[i];
      const stepPreamble = i > 0 && this.includeStepPreamble
        ? ctx.genStepPreamble(pc, opsBefore)
        : '';
      const comment = `// ${disassembleInstruction(pc, this.instructions[i], false).disassembly}\n`;
      fast += `${stepPreamble}${comment}  ramStoreDV.setUint32(ramStoreBase + ${offset - minOffset}, ${gprS32Lo(rt)}, false);\n`;
      slow += `${stepPreamble}${this.emitStoreBlock(ctx, i, i > 0)}`;
    }
    fast += `  c.pc = ${toString32(this.lastPC + 4)};\n`;
    const slowParams = ctx.opsCounterVar ? `c, rsp, ${ctx.opsCounterVar}` : 'c, rsp';
    // Flipping bit 31 via `^ -0x80000000` wraps the 32-bit virtual address sum
    // via ToInt32 and translates kseg0 (0x80000000..0x807fffff) to a signed
    // Int32 physical RAM offset (0x00000000..0x007fffff) without using a
    // positive 0x80000000 Double literal. Any kuseg/TLB address (< 0x80000000)
    // becomes negative (bit 31 set), so `(ramStoreBase & 0x80000003) === 0`
    // checks both `ramStoreBase >= 0` and 4-byte word alignment in one mask.
    ctx.fragment.bodyCode += `// Guarded RAM SW group (${this.count} stores)
{
  const ramStoreBase = (${gprS32Lo(this.base)} + ${minOffset}) ^ -0x80000000;
  const ramStoreDV = c.ramDV;
  if ((ramStoreBase & 0x80000003) === 0 && ramStoreBase + ${span} <= Math.min(ramStoreDV.byteLength, 0x800000)) {
${fast}  } else {
    const slowExit = ((${slowParams}) => {
${slow}    })(${slowParams});
    if (slowExit !== undefined) { return slowExit; }
  }
}
`;
    this.reset();
  }
}
