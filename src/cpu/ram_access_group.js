import {
  OP_LW,
  OP_SW,
  OP_LWC1,
  OP_LDC1,
  OP_SWC1,
  OP_SDC1,
  simpleOp,
} from './decode.js';
import { disassembleInstruction } from './disassemble.js';
import { toString32 } from '../format.js';

function gprS32Lo(reg) {
  return reg === 0 ? '0' : `c.gprS32[${reg * 2}]`;
}

function cop1WordIndex(reg) {
  return (reg & 1) === 0 ? `${reg * 2}` : `cpu1.regIdx32_cop[${reg}]`;
}

const GROUP_SPECS = Object.freeze({
  [OP_SW]: Object.freeze({
    name: 'SW',
    noun: 'stores',
    baseVar: 'ramStoreBase',
    dvVar: 'ramStoreDV',
    width: 4,
    alignMask: 3,
    guardMask: '0x80000003',
    helper: 'execSW',
    writesGpr: false,
    usesCop1: false,
    emitFast(i, reg, relOffset) {
      return `  ramStoreDV.setUint32(ramStoreBase + ${relOffset}, ${gprS32Lo(reg)}, false);\n`;
    },
  }),
  [OP_LW]: Object.freeze({
    name: 'LW',
    noun: 'loads',
    baseVar: 'ramLoadBase',
    dvVar: 'ramLoadDV',
    width: 4,
    alignMask: 3,
    guardMask: '0x80000003',
    helper: 'execLW',
    writesGpr: true,
    usesCop1: false,
    emitFast(i, reg, relOffset) {
      if (reg === 0) {
        return '';
      }
      return `  const v${i} = ramLoadDV.getInt32(ramLoadBase + ${relOffset}, false);\n` +
        `  c.gprS32[${reg * 2}] = v${i};\n` +
        `  c.gprS32[${reg * 2 + 1}] = v${i} >> 31;\n`;
    },
  }),
  // Use signed Int32 DataView methods and cpu1.regS32 for raw COP1 word copies:
  // negative IEEE-754 floats have bit 31 set, which causes getUint32/Uint32Array
  // reads to exceed signed Int32 range (>= 0x80000000) and trigger JS JIT
  // Int32 speculation failures / Double boxing.
  [OP_LWC1]: Object.freeze({
    name: 'LWC1',
    noun: 'loads',
    baseVar: 'ramLoadBase',
    dvVar: 'ramLoadDV',
    width: 4,
    alignMask: 3,
    guardMask: '0x80000003',
    helper: 'execLWC1Unchecked',
    writesGpr: false,
    usesCop1: true,
    emitFast(i, reg, relOffset) {
      return `  cpu1.regS32[${cop1WordIndex(reg)}] = ramLoadDV.getInt32(ramLoadBase + ${relOffset}, false);\n`;
    },
  }),
  [OP_SWC1]: Object.freeze({
    name: 'SWC1',
    noun: 'stores',
    baseVar: 'ramStoreBase',
    dvVar: 'ramStoreDV',
    width: 4,
    alignMask: 3,
    guardMask: '0x80000003',
    helper: 'execSWC1Unchecked',
    writesGpr: false,
    usesCop1: true,
    emitFast(i, reg, relOffset) {
      return `  ramStoreDV.setInt32(ramStoreBase + ${relOffset}, cpu1.regS32[${cop1WordIndex(reg)}], false);\n`;
    },
  }),
  [OP_LDC1]: Object.freeze({
    name: 'LDC1',
    noun: 'loads',
    baseVar: 'ramLoadBase',
    dvVar: 'ramLoadDV',
    width: 8,
    alignMask: 7,
    guardMask: '0x80000007',
    helper: 'execLDC1Unchecked',
    writesGpr: false,
    usesCop1: true,
    emitFast(i, reg, relOffset) {
      if ((reg & 1) === 0) {
        return `  cpu1.regS32[${reg * 2 + 1}] = ramLoadDV.getInt32(ramLoadBase + ${relOffset}, false);\n` +
          `  cpu1.regS32[${reg * 2}] = ramLoadDV.getInt32(ramLoadBase + ${relOffset + 4}, false);\n`;
      }
      return `  const f${i} = cpu1.regIdx64_cop[${reg}] * 2;\n` +
        `  cpu1.regS32[f${i} + 1] = ramLoadDV.getInt32(ramLoadBase + ${relOffset}, false);\n` +
        `  cpu1.regS32[f${i}] = ramLoadDV.getInt32(ramLoadBase + ${relOffset + 4}, false);\n`;
    },
  }),
  [OP_SDC1]: Object.freeze({
    name: 'SDC1',
    noun: 'stores',
    baseVar: 'ramStoreBase',
    dvVar: 'ramStoreDV',
    width: 8,
    alignMask: 7,
    guardMask: '0x80000007',
    helper: 'execSDC1Unchecked',
    writesGpr: false,
    usesCop1: true,
    emitFast(i, reg, relOffset) {
      if ((reg & 1) === 0) {
        return `  ramStoreDV.setInt32(ramStoreBase + ${relOffset}, cpu1.regS32[${reg * 2 + 1}], false);\n` +
          `  ramStoreDV.setInt32(ramStoreBase + ${relOffset + 4}, cpu1.regS32[${reg * 2}], false);\n`;
      }
      return `  const f${i} = cpu1.regIdx64_cop[${reg}] * 2;\n` +
        `  ramStoreDV.setInt32(ramStoreBase + ${relOffset}, cpu1.regS32[f${i} + 1], false);\n` +
        `  ramStoreDV.setInt32(ramStoreBase + ${relOffset + 4}, cpu1.regS32[f${i}], false);\n`;
    },
  }),
});

function getGroupSpec(ctx) {
  if (ctx.needsDelayCheck || ctx.postPC !== ctx.pc + 4) {
    return null;
  }
  const spec = GROUP_SPECS[simpleOp(ctx.instruction)];
  if (!spec || (spec.usesCop1 && !ctx.fragment.cop1statusKnown)) {
    return null;
  }
  return spec;
}

// Groups consecutive, sequential cached-RAM loads or stores of the same kind
// (SW, LW, or unchecked LWC1/SWC1/LDC1/SDC1) with an unchanged base. On a
// proven cached-RAM hit, accesses read/write the big-endian DataView and
// register arrays directly, omitting per-access exception and MMIO-interrupt
// bookkeeping while keeping inter-instruction RSP steps. A failed guard runs
// the original per-instruction helpers and bookkeeping in order.
export class RAMAccessGroup {
  constructor() {
    // The production compiler reuses one FragmentContext. Keep its bounded
    // scratch buffers across groups and fragments; retain no generated strings.
    this.pcs = new Uint32Array(16);
    this.opsBefore = new Uint16Array(16);
    this.instructions = new Uint32Array(16);
    this.offsets = new Int32Array(16);
    this.registers = new Uint8Array(16);
    this.count = 0;
    this.spec = GROUP_SPECS[OP_SW];
    this.base = 0;
    this.lastPC = 0;
    this.lastOffset = 0;
    this.minOffset = 0;
    this.maxOffset = 0;
    this.includeStepPreamble = false;
    this.clobbersBase = false;
  }

  reset() {
    // Entries beyond count are dead. add() overwrites the scalar bounds on the
    // first access, so clearing the buffers or other fields would be wasted work.
    this.count = 0;
  }

  canAppend(base, offset, pc, spec = this.spec) {
    return this.count > 0 &&
      this.count < this.pcs.length &&
      spec === this.spec &&
      !this.clobbersBase &&
      base === this.base &&
      pc === this.lastPC + 4 &&
      ((offset - this.lastOffset) & spec.alignMask) === 0;
  }

  tryAdd(ctx, includeStepPreamble = false) {
    const spec = getGroupSpec(ctx);
    if (this.count > 0 && (!spec || !this.canAppend(ctx.instr_base(), ctx.instr_imms(), ctx.pc, spec))) {
      this.finish(ctx);
    }
    if (!spec) {
      return false;
    }
    if (this.count === 0) {
      if (includeStepPreamble) {
        ctx.fragment.bodyCode += ctx.genStepPreamble();
      }
      if (ctx.delayedPCUpdate !== 0) {
        ctx.fragment.bodyCode += `// Applying delayed pc\nc.pc = ${toString32(ctx.delayedPCUpdate)};\n`;
        ctx.delayedPCUpdate = 0;
      }
    }
    if (spec.usesCop1) {
      ctx.fragment.usesCop1 = true;
    }
    ctx.gprFacts.update(ctx.instruction);
    ctx.forwardedComparison = null;
    ctx.fragment.needsDelayCheck = false;
    this.add(ctx, includeStepPreamble, spec);
    return true;
  }

  add(ctx, includeStepPreamble = false, spec = getGroupSpec(ctx) ?? GROUP_SPECS[OP_SW]) {
    const base = ctx.instr_base();
    const offset = ctx.instr_imms();
    const rt = ctx.instr_rt();
    if (this.count === 0) {
      this.spec = spec;
      this.base = base;
      this.minOffset = offset;
      this.maxOffset = offset;
      this.includeStepPreamble = includeStepPreamble;
      this.clobbersBase = false;
    } else {
      this.minOffset = Math.min(this.minOffset, offset);
      this.maxOffset = Math.max(this.maxOffset, offset);
    }
    if (spec.writesGpr && rt !== 0 && rt === base) {
      this.clobbersBase = true;
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

  emitAccessBlock(ctx, i, includeComment = false) {
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
      `  c.${this.spec.helper}(${rt}, ${this.base}, ${offset});\n` +
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
      ctx.fragment.bodyCode += this.emitAccessBlock(ctx, 0, true);
      this.reset();
      return;
    }
    const spec = this.spec;
    const minOffset = this.minOffset;
    const span = this.maxOffset - minOffset + spec.width;
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
      fast += `${stepPreamble}${comment}${spec.emitFast(i, rt, offset - minOffset)}`;
      slow += `${stepPreamble}${this.emitAccessBlock(ctx, i)}`;
    }
    fast += `  c.pc = ${toString32(this.lastPC + 4)};\n`;
    const slowParams = ctx.opsCounterVar ? `c, rsp, ${ctx.opsCounterVar}` : 'c, rsp';
    // Flipping bit 31 via `^ -0x80000000` wraps the 32-bit virtual address sum
    // via ToInt32 and translates kseg0 (0x80000000..0x807fffff) to a signed
    // Int32 physical RAM offset (0x00000000..0x007fffff) without using a
    // positive 0x80000000 Double literal. Any kuseg/TLB address (< 0x80000000)
    // becomes negative (bit 31 set), so `(${spec.baseVar} & ${spec.guardMask}) === 0`
    // checks both `${spec.baseVar} >= 0` and natural alignment in one mask.
    ctx.fragment.bodyCode += `// Guarded RAM ${spec.name} group (${this.count} ${spec.noun})
{
  const ${spec.baseVar} = (${gprS32Lo(this.base)} + ${minOffset}) ^ -0x80000000;
  const ${spec.dvVar} = c.ramDV;
  if ((${spec.baseVar} & ${spec.guardMask}) === 0 && ${spec.baseVar} + ${span} <= Math.min(${spec.dvVar}.byteLength, 0x800000)) {
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

