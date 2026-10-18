/*global n64js*/

import * as cpu0reg from './cpu0reg.js';
import { GPRFacts, constant64, isSigned32, isUnsigned32, isKnown32 } from './gpr_facts.js';
import { RAMStoreGroup } from './ram_store_group.js';
import { convertModeCeil, convertModeFloor, convertModeRound, convertModeTrunc } from './cpu1.js';
import { disassembleInstruction } from './disassemble.js';
import { toString32 } from '../format.js';
import { assert } from '../assert.js';
import { kAccurateCountUpdating, kSpeedHackEnabled } from '../options.js';
import { OP_J, OP_BEQ, OP_BNE, OP_COP0, OP_SW, OP_CACHE, COP_MT, COP_DMT, simpleOp, regImmOp, specialOp, copOp, isWait, copFmtFuncOp, fd, fs, ft, offset, sa, rd, rt, rs, tlbop, imm, imms, base, branchAddress, jumpAddress } from './decode.js';

const kDebugDynarec = false;
const kValidateDynarecPCs = false;
const kUseOptimisedDynarecHandlers = true;

// TODO: dedupe with r4300.js.
const cop1ADD = 0x00;
const cop1SUB = 0x01;
const cop1MUL = 0x02;
const cop1DIV = 0x03;
const cop1SQRT = 0x04;
const cop1ABS = 0x05;
const cop1MOV = 0x06;
const cop1NEG = 0x07;
const cop1ROUND_L = 0x08;
const cop1TRUNC_L = 0x09;
const cop1CEIL_L = 0x0a;
const cop1FLOOR_L = 0x0b;
const cop1ROUND_W = 0x0c;
const cop1TRUNC_W = 0x0d;
const cop1CEIL_W = 0x0e;
const cop1FLOOR_W = 0x0f;
const cop1CVT_S = 0x20;
const cop1CVT_D = 0x21;
const cop1CVT_W = 0x24;
const cop1CVT_L = 0x25;


export class FragmentContext {
  constructor() {
    this.fragment = undefined;
    this.pc = 0;
    this.instruction = 0;
    this.postPC = 0;
    this.bailOut = false; // Set this if the op does something to manipulate event timers.
    this.nextPC = 0;

    this.needsDelayCheck = true; // Set on entry to generate handler. If set, must check for delayPC when updating the pc.
    this.isTrivial = false; // Set by the code generation handler if the op is considered trivial.
    this.delayedPCUpdate = 0; // Trivial ops can try to delay setting the pc so that back-to-back trivial ops can emit them entirely.
    this.dump = false; // Display this op when finished.
    this.gprFacts = new GPRFacts();
    this.forwardedComparison = null;
    this.pendingComparison = null;
    this.opsCounterVar = null;
    this.ramStoreGroup = new RAMStoreGroup();
  }

  genAssert(test, msg) {
    if (kDebugDynarec) {
      return 'window.n64jsAssert(' + test + ', "' + msg + '");\n';
    }
    return '';
  }

  // Formats an instruction count relative to the start of the fragment, or
  // relative to opsCounterVar (e.g. 'opsExecuted + 3') when emitting the body
  // of a multi-iteration self-looping fragment.
  opsCountExpr(opsInIteration) {
    if (!this.opsCounterVar) {
      return `${opsInIteration}`;
    }
    return opsInIteration === 0
      ? this.opsCounterVar
      : `${this.opsCounterVar} + ${opsInIteration}`;
  }

  genReturnOps(opsInIteration = this.fragment.opsCompiled) {
    return `return ${this.opsCountExpr(opsInIteration)};`;
  }

  genSetFragmentOps(opsInIteration = this.fragment.opsCompiled - 1) {
    return `c.fragmentOps = ${this.opsCountExpr(opsInIteration)};`;
  }

  genSyncFragmentCycles(opsInIteration = this.fragment.opsCompiled - 1) {
    return `c.syncFragmentCycles(${this.opsCountExpr(opsInIteration)});`;
  }

  // Emits the per-instruction RSP step and interrupt check that precedes each
  // compiled CPU instruction.
  // Hoist the !rsp.halted check into the generated trace so the JS JIT can fold
  // redundant loads across consecutive instructions when the RSP is halted, and
  // avoid calling rsp.step() on the common halted path.
  // When !kAccurateCountUpdating, every instruction that can set c.stuffToDo
  // checks it before falling through to the next instruction, and runImpl()
  // enters fragments with c.stuffToDo === 0, so c.stuffToDo can only become
  // non-zero here if rsp.step() ran and raised an interrupt or break.
  genStepPreamble(stepPC = this.pc, opsBefore = this.fragment.opsCompiled - 1) {
    if (kAccurateCountUpdating) {
      return `if (!rsp.halted) { rsp.step(); }\nif (c.stuffToDo) { c.pc = ${stepPC}; ${this.genReturnOps(opsBefore)} }\n\n`;
    }
    return `if (!rsp.halted) { rsp.step(); if (c.stuffToDo) { c.pc = ${stepPC}; ${this.genReturnOps(opsBefore)} } }\n\n`;
  }

  flushDelayedPCUpdate() {
    finishCodeGeneration(this);
    // Check if the last op has a delayed pc update, and do it now.
    if (this.delayedPCUpdate !== 0) {
      this.fragment.bodyCode += `c.pc = ${toString32(this.delayedPCUpdate)};\n`;
      this.delayedPCUpdate = 0;
    }
  }
  
  newFragment(opsCounterVar = null) {
    this.delayedPCUpdate = 0;
    this.gprFacts.reset();
    this.forwardedComparison = null;
    this.opsCounterVar = opsCounterVar;
    this.ramStoreGroup.reset();
  }

  set(fragment, pc, instruction, postPC, nextPC) {
    // Also cover direct code-generation callers and invalidated/rebuilt traces.
    if (this.fragment !== fragment || fragment.opsCompiled <= 1) {
      this.newFragment(this.opsCounterVar);
    }
    this.fragment = fragment;
    this.pc = pc;
    this.instruction = instruction;
    this.postPC = postPC;
    this.nextPC = nextPC;
    this.bailOut = false;

    this.needsDelayCheck = true;
    this.isTrivial = false;
    this.pendingComparison = null;

    this.dump = false;

    // Persist this between ops
    // this.delayedPCUpdate = 0;
  }

  instr_rs() { return rs(this.instruction); }
  instr_rt() { return rt(this.instruction); }
  instr_rd() { return rd(this.instruction); }
  instr_sa() { return sa(this.instruction); }

  instr_fs() { return fs(this.instruction); }
  instr_ft() { return ft(this.instruction); }
  instr_fd() { return fd(this.instruction); }

  instr_base() { return base(this.instruction); }
  instr_offset() { return offset(this.instruction); }
  instr_imms() { return imms(this.instruction); }
  instr_imm() { return imm(this.instruction); }

  instr_tlbop() { return tlbop(this.instruction); }
}

// Returns true if compiling `instruction` at `pc` sets `ctx.bailOut`, which
// ends the trace immediately and prevents wrapping the fragment in a self-loop.
export function instructionBailsOut(pc, instruction) {
  switch (simpleOp(instruction)) {
    case OP_J:
      return kSpeedHackEnabled && jumpAddress(pc, instruction) === pc;
    case OP_BEQ:
    case OP_BNE:
      return kSpeedHackEnabled && offset(instruction) === -1;
    case OP_COP0: {
      if (instruction & 0x02000000) {
        return false;
      }
      const cop = copOp(instruction);
      const reg = fs(instruction);
      return (cop === COP_MT || cop === COP_DMT) &&
        (reg === cpu0reg.controlCount || reg === cpu0reg.controlCompare);
    }
    case OP_CACHE:
      return !n64js.cpu0.ignoreCacheOp(rt(instruction));
    default:
      return false;
  }
}

export function generateCodeForOp(ctx, { includeStepPreamble = false } = {}) {
  ctx.needsDelayCheck = ctx.fragment.needsDelayCheck;
  ctx.isTrivial = false;

  // Never specialize debug code or a dynamic delay-slot/trace boundary.
  // SW cannot change its base, even when the value register aliases the base.
  const groupStore = !kDebugDynarec && !kValidateDynarecPCs && !kAccurateCountUpdating &&
    simpleOp(ctx.instruction) === OP_SW && !ctx.needsDelayCheck && ctx.postPC === ctx.pc + 4;
  if (ctx.ramStoreGroup.count && (!groupStore ||
      !ctx.ramStoreGroup.canAppend(ctx.instr_base(), ctx.instr_imms(), ctx.pc))) {
    finishCodeGeneration(ctx);
  }

  if (groupStore) {
    if (ctx.ramStoreGroup.count === 0) {
      if (includeStepPreamble) {
        ctx.fragment.bodyCode += ctx.genStepPreamble();
      }
      if (ctx.delayedPCUpdate !== 0) {
        ctx.fragment.bodyCode += `// Applying delayed pc\nc.pc = ${toString32(ctx.delayedPCUpdate)};\n`;
        ctx.delayedPCUpdate = 0;
      }
    }
    ctx.gprFacts.update(ctx.instruction);
    ctx.forwardedComparison = null;
    ctx.fragment.needsDelayCheck = false;
    ctx.ramStoreGroup.add(ctx, includeStepPreamble);
    return;
  }

  if (includeStepPreamble) {
    ctx.fragment.bodyCode += ctx.genStepPreamble();
  }

  let preflight = '';
  if (kValidateDynarecPCs) {
    preflight = dedent(`
      if (c.pc != ${toString32(ctx.pc)}) {
        throw 'expected pc ${toString32(ctx.pc)}, got ' + c.pc.toString(16);
      }
    `);
  }

  let fn_code = preflight + generateOp(ctx);
  ctx.gprFacts.update(ctx.instruction);
  ctx.forwardedComparison = ctx.pendingComparison;

  if (ctx.dump) {
    console.log(fn_code);
  }

  // If the last op tried to delay updating the pc, see if it needs updating now.
  if (!ctx.isTrivial && ctx.delayedPCUpdate !== 0) {
    // TODO: add a template string function to dedent this.
    ctx.fragment.bodyCode += `// Applying delayed pc\nc.pc = ${toString32(ctx.delayedPCUpdate)};\n`;
    ctx.delayedPCUpdate = 0;
  }

  // Timer-changing operations, including idle-loop skips, need current event time.
  if (ctx.bailOut) {
    fn_code = `${ctx.genSyncFragmentCycles()}\n${fn_code}`;
  }

  // If this operation throws, run() must still charge the preceding instructions.
  if (!ctx.isTrivial) {
    fn_code = `${ctx.genSetFragmentOps()}\n${fn_code}`;
  }

  ctx.fragment.needsDelayCheck = ctx.needsDelayCheck;

  // code += `if (!checkEqual( loadS32slow(cpu0.pc >>> 0), ${toString32(instruction)}, "unexpected instruction (need to flush icache?)")) { return false; }\n`;

  ctx.fragment.bailedOut |= ctx.bailOut;

  const dasm = disassembleInstruction(ctx.pc, ctx.instruction, false);
  const lines = redentLines(fn_code, '  ');

  ctx.fragment.bodyCode += `// ${dasm.disassembly}\n{\n${lines}\n}\n\n`;
}

export function finishCodeGeneration(ctx) {
  ctx.ramStoreGroup.finish(ctx);
}

export function emitTraceStep(fragment, step, ctx) {
  ctx.set(fragment, step.pc, step.instruction, step.postPC, step.nextPC);
  generateCodeForOp(ctx, { includeStepPreamble: true });
}

// Compiles a fragment's recorded `traceSteps` in a single pass.
// When `selfLoop` is true, emits intra-iteration exits relative to
// `opsExecuted` and wraps the body in a do-while loop that runs until the next
// scheduled event deadline (`cyclesToFirstEvent`) or an early exit.
export function compileTraceSteps(fragment, ctx = new FragmentContext(), { selfLoop = false } = {}) {
  const totalOps = fragment.traceSteps.length;
  fragment.bodyCode = '';
  fragment.needsDelayCheck = true;
  fragment.cop1statusKnown = false;
  fragment.usesCop1 = false;
  ctx.newFragment(selfLoop ? 'opsExecuted' : null);

  for (let i = 0; i < totalOps; i++) {
    fragment.opsCompiled = i + 1;
    emitTraceStep(fragment, fragment.traceSteps[i], ctx);
  }
  ctx.flushDelayedPCUpdate();

  const bodyCode = selfLoop
    ? `let opsExecuted = 0;\ndo {\n${fragment.bodyCode}opsExecuted += ${totalOps};\n} while (c.canContinueSelfLoop(opsExecuted, ${totalOps}));\nreturn opsExecuted;\n`
    : `${fragment.bodyCode}${ctx.genReturnOps(totalOps)}\n`;
  ctx.opsCounterVar = null;
  return bodyCode;
}

// Indents all lines to the provided indent, removing any empty lines.
function redentLines(code, indent) {
  // TODO: it would make more sense to dedent the literals where they're declared.
  const dedented = dedent(code);
  const lines = dedented.split('\n');
  const filtered = lines.filter(l => l != '');
  const indented = filtered.map(l => indent + l);
  return indented.join('\n');
}

function dedent(str) {
  str = str.replace(/^\n/, '');
  const match = str.match(/^\s+/);
  if (!match) {
    return str;
  }
  const prefix = match[0];
  return match ? str.replace(new RegExp('^' + prefix, 'gm'), '') : str;
}

function addNewlines(code) {
  if (!code.startsWith("\n")) {
    code = "\n" + code;
  }
  if (!code.endsWith("\n")) {
    code += "\n";
  }
  return code;
}

// Standard code for manipulating the pc
function generateStandardPCUpdate(fn, ctx, might_adjust_next_pc) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    // We should probably assert on this - two branch instructions back-to-back is weird, but the flag could just be set because of a generic op
    code += `if (c.delayPC !== null) { c.nextPC = c.delayPC; c.delayPC = null; } else { c.nextPC = ${toString32(ctx.pc + 4)}; }\n`;
    code += addNewlines(fn);
    code += 'c.pc = c.nextPC;\n';
  } else if (might_adjust_next_pc) {
    // If the branch op might manipulate nextPC, we need to ensure that it's set to the correct value
    code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
    code += addNewlines(fn);
    code += 'c.pc = c.nextPC;\n';
  } else {
    code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');
    code += addNewlines(fn);
    code += `c.pc = ${toString32(ctx.pc + 4)};\n`;
  }

  return code;
}

function generateGenericOpBoilerplate(fn, ctx) {
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');

  if (ctx.needsDelayCheck) {
    code += `c.nextPC = c.delayPC ?? ${toString32(ctx.pc + 4)};\n`;
  } else {
    code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
  }
  code += 'c.branchTarget = null;\n';
  code += addNewlines(fn);
  code += 'c.pc = c.nextPC;\n';
  code += 'c.delayPC = c.branchTarget;\n';

  // We don't know if the generic op set delayPC, so assume the worst.
  ctx.needsDelayCheck = true;

  if (kAccurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // If bailOut is set, always return immediately.
  if (ctx.bailOut) {
    code += `${ctx.genReturnOps()}\n`;
  } else {
    code += `if (c.stuffToDo) { ${ctx.genReturnOps()} }\n`;
    code += `if (c.pc !== ${toString32(ctx.postPC)}) { ${ctx.genReturnOps()} }\n`;
  }

  return code;
}

// Helper effects audited through r4300.js, memaccess.js and the device
// handlers. mayChangeNextPC describes normal return only. Integer alignment/TLB
// exceptions change nextPC but throw;
// MMIO may request interrupt service or start the RSP, without changing nextPC.
// Keep exception PC/fragmentOps materialization and the post-access stuffToDo
// check: servicing an interrupt must precede the following rsp.step().
const integerMemoryEffects = Object.freeze({
  mayThrow: true,
  mayChangeNextPC: false,
  maySetStuffToDo: true,
  mayStartRSP: true,
});

// execLWC1/LDC1/SWC1/SDC1Unchecked only move raw bits using the current FR
// mapping and the same memory paths as integer loads/stores. Alignment/TLB
// exceptions throw; normal returns cannot change nextPC or introduce a delay.
// MMIO can still request an interrupt or start the RSP. This audit does not
// cover COP1 arithmetic/compare helpers, whose FPU exceptions return normally.
const uncheckedCop1MemoryEffects = integerMemoryEffects;

// Unknown helpers (including COP2 usability exceptions) may redirect and return.
const conservativeMemoryEffects = Object.freeze({
  ...integerMemoryEffects,
  mayChangeNextPC: true,
});

// Memory access does not adjust branchTarget.
function generateMemoryAccessBoilerplate(fn, ctx, effects = conservativeMemoryEffects) {
  // Capture entry knowledge before clearing needsDelayCheck below. A pending
  // delay target is dynamic even when the training trace happened to fall through.
  const needsPCGuard = ctx.needsDelayCheck || effects.mayChangeNextPC || ctx.postPC !== ctx.pc + 4;
  let code = '';
  code += ctx.genAssert(`c.pc === ${toString32(ctx.pc)}`, 'pc mismatch');
  if (ctx.needsDelayCheck) {
    code += `c.nextPC = c.delayPC ?? ${toString32(ctx.pc + 4)};\n`;
  } else {
    code += `c.nextPC = ${toString32(ctx.pc + 4)};\n`;
  }
  // Keep delayPC until after the access: exceptions use it to set EPC and Cause.BD.
  code += addNewlines(fn);
  code += 'c.pc = c.nextPC;\nc.delayPC = null;\n';

  // Memory instructions never cause a branch delay
  code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');
  ctx.needsDelayCheck = false;

  if (kAccurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // If bailOut is set, always return immediately
  assert(!ctx.bailOut, "Not expecting bailOut to be set for memory access");
  code += `if (c.stuffToDo) { ${ctx.genReturnOps()} }\n`;
  if (needsPCGuard) {
    code += `if (c.pc !== ${toString32(ctx.postPC)}) { ${ctx.genReturnOps()} }\n`;
  }
  return code;
}

// Branch ops explicitly manipulate nextPC rather than branchTarget. They also guarantee that stuffToDo is not set.
// might_adjust_next_pc is typically used by branch likely instructions.
function generateBranchOpBoilerplate(fn, ctx, might_adjust_next_pc) {
  let code = '';

  // We only need to check for off-trace branches
  const need_pc_test = ctx.needsDelayCheck || might_adjust_next_pc || ctx.postPC !== ctx.pc + 4;

  code += generateStandardPCUpdate(fn, ctx, might_adjust_next_pc);

  // Branch instructions can always set a branch delay
  ctx.needsDelayCheck = true;

  if (kAccurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

  // If bailOut is set, always return immediately
  if (ctx.bailOut) {
    code += `${ctx.genReturnOps()}\n`;
  } else {
    if (need_pc_test) {
      code += `if (c.pc !== ${toString32(ctx.postPC)}) { ${ctx.genReturnOps()} }\n`;
    } else {
      code += '// Skipping pc test\n';
    }
  }

  return code;
}

// Trivial ops can use this specialised handler which eliminates a lot of overhead.
// Trivial ops are defined as those which:
// Don't require cpu0.pc to be set correctly (required by branches, stuff that can throw exceptions for instance)
// Don't set cpu0.stuffToDo
// Don't set branchTarget
// Don't manipulate nextPC (e.g. ERET, cop1 unusable, likely instructions)

function generateTrivialOpBoilerplate(fn, ctx) {
  let code = '';

  // NB: trivial functions don't rely on pc being set up, so we perform the op before updating the pc.
  code += addNewlines(fn);

  ctx.isTrivial = true;

  if (kAccurateCountUpdating) {
    code += 'c.incrementCount(1);\n';
  }

  // NB: do delay handler after executing op, so we can set pc directly
  if (ctx.needsDelayCheck) {
    code += `if (c.delayPC !== null) { c.pc = c.delayPC; c.delayPC = null; } else { c.pc = ${toString32(ctx.pc + 4)}; }\n`;
    // Might happen: delay op from previous instruction takes effect
    code += `if (c.pc !== ${toString32(ctx.postPC)}) { ${ctx.genReturnOps()} }\n`;
  } else {
    code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');

    // We can avoid off-branch checks in this case.
    const expectedPC = ctx.pc + 4;
    if (ctx.postPC !== expectedPC) {
      code += `c.pc = ${toString32(expectedPC)};\n`;
      code += `if (c.pc !== ${toString32(ctx.postPC)}) { ${ctx.genReturnOps()} }\n`;
    } else {
      code += '// Delaying pc update\n';
      ctx.delayedPCUpdate = expectedPC;
      if (kValidateDynarecPCs) {
        code += `c.pc = ${toString32(expectedPC)};\n`;
      }
    }
  }

  // Trivial instructions never cause a branch delay
  code += ctx.genAssert('c.delayPC === null', 'delay pc should be null');
  ctx.needsDelayCheck = false;

  // Trivial instructions never cause stuffToDo to be set
  code += ctx.genAssert('c.stuffToDo === 0', 'stuffToDo should be zero');

  return code;
}

function generateNOPBoilerplate(comment, ctx) {
  return generateTrivialOpBoilerplate(`// ${comment}\n`, ctx);
}

function genSrcRegU32Lo(i) {
  if (i === 0) {
    return '0';
  }
  return `c.getRegU32Lo(${i})`;
}

// A signed 64-bit value's sign is entirely in its high word.
function genSrcRegS32Hi(i) {
  return i === 0 ? '0' : `c.gprS32[${i * 2 + 1}]`;
}

function genGprS32Lo(i) {
  return i === 0 ? '0' : `c.gprS32[${i * 2}]`;
}

function genGprU32Lo(i) {
  return i === 0 ? '0' : `c.gprU32[${i * 2}]`;
}

function genGprU32Hi(i) {
  return i === 0 ? '0' : `c.gprU32[${i * 2 + 1}]`;
}

// Emit direct constant-indexed typed-array stores instead of calling
// setRegS64LoHi / setRegS32Extend: those helpers exceed V8's small-function
// inlining threshold and quickly exhaust the fragment's inlining budget.
function genSetRegS64LoHi(r, lo, hi) {
  if (r === 0) {
    return '';
  }
  return `c.gprS32[${r * 2}] = ${lo};\nc.gprS32[${r * 2 + 1}] = ${hi};`;
}

function genSetRegS32Extend(r, expr) {
  if (r === 0) {
    return '';
  }
  return `const v = ${expr};\nc.gprS32[${r * 2}] = v;\nc.gprS32[${r * 2 + 1}] = v >> 31;`;
}

function genSetRegS32Const(r, val) {
  const v = val | 0;
  return genSetRegS64LoHi(r, v, v >> 31);
}

function genIsPositive(ctx, i) {
  const fact = ctx.gprFacts.get(i);
  if (isKnown32(fact)) {
    return `${genKnownNumber(i, fact)} > 0`;
  }
  const hi = genSrcRegS32Hi(i);
  return `${hi} >= 0 && (${hi} | c.gprS32[${i * 2}]) !== 0`;
}

function genKnownNumber(reg, fact) {
  if (fact.kind === 'constant64') {
    return `${Number(fact.value)}`;
  }
  return `c.getReg${isSigned32(fact) ? 'S' : 'U'}32Lo(${reg})`;
}

function genLessThan(ctx, s, t, unsigned, immediate = null) {
  const sf = ctx.gprFacts.get(s);
  const tf = immediate === null ? ctx.gprFacts.get(t) : constant64(BigInt(immediate));
  if (unsigned) {
    // Unsigned ordering of two sign-extended words matches their unsigned low
    // words. A mixed signed/zero-extended pair does NOT have this property.
    if ((isSigned32(sf) && isSigned32(tf)) || (isUnsigned32(sf) && isUnsigned32(tf))) {
      const rhs = immediate === null ? genSrcRegU32Lo(t) : `${immediate >>> 0}`;
      return `${genSrcRegU32Lo(s)} < ${rhs}`;
    }
  } else if (isKnown32(sf) && isKnown32(tf)) {
    return `${genKnownNumber(s, sf)} < ${genKnownNumber(t, tf)}`;
  }
  // Unknown-width inputs still have an exact lexicographic word comparison.
  // Only the high word is signed; equal high words compare unsigned low words.
  const high = reg => reg === 0 ? '0' : `c.gpr${unsigned ? 'U' : 'S'}32[${reg * 2 + 1}]`;
  const sh = high(s);
  const th = immediate === null ? high(t) : `${unsigned ? (immediate >> 31) >>> 0 : immediate >> 31}`;
  const tl = immediate === null ? genSrcRegU32Lo(t) : `${immediate >>> 0}`;
  return `(${sh} === ${th} ? ${genSrcRegU32Lo(s)} < ${tl} : ${sh} < ${th})`;
}

function generateComparison(ctx, d, s, t, unsigned, immediate = null) {
  const name = `compare_${ctx.fragment.opsCompiled}`;
  if (d !== 0) {
    ctx.pendingComparison = { reg: d, name, index: ctx.fragment.opsCompiled };
  }
  // var spans the per-instruction blocks, but is local to this invocation.
  // Materialize the architectural result before any intervening RSP step/exit.
  const impl = `var ${name} = ${genLessThan(ctx, s, t, unsigned, immediate)};\n` +
    `c.setRegU32Extend(${d}, ${name} ? 1 : 0);`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function genEquality(ctx, s, t, equal) {
  const forwarded = ctx.forwardedComparison;
  if (forwarded && forwarded.index + 1 === ctx.fragment.opsCompiled &&
      ((s === forwarded.reg && t === 0) || (t === forwarded.reg && s === 0))) {
    return `${equal ? '!' : ''}${forwarded.name}`;
  }
  const op = equal ? '===' : '!==';
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  if (isKnown32(sf) && isKnown32(tf)) {
    return `${genKnownNumber(s, sf)} ${op} ${genKnownNumber(t, tf)}`;
  }
  // Use constant word indices in compiled code, avoiding BigInt reads and a
  // helper call on branches whose register widths are not known statically.
  const word = (reg, hi) => reg === 0 ? '0' : `c.gprU32[${reg * 2 + hi}]`;
  return `(${word(s, 0)} ${op} ${word(t, 0)} ${equal ? '&&' : '||'} ${word(s, 1)} ${op} ${word(t, 1)})`;
}

function generateUnknown(ctx) {
  const impl = `throw 'unknown op, pc ${toString32(ctx.pc)}, instruction: ${toString32(ctx.instruction)}'`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateSLL(ctx) {
  // NOP
  if (ctx.instruction === 0) {
    return generateNOPBoilerplate('NOP', ctx);
  }
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (tf.kind === 'constant64') {
    impl = genSetRegS32Const(d, Number(BigInt.asIntN(32, tf.value)) << shift);
  } else if (shift === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else {
    impl = genSetRegS32Extend(d, `${genGprS32Lo(t)} << ${shift}`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRL(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (tf.kind === 'constant64') {
    impl = genSetRegS32Const(d, Number(BigInt.asUintN(32, tf.value)) >>> shift);
  } else if (shift === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else {
    // Non-zero logical right shift clears bit 31, so the high word is 0.
    impl = genSetRegS64LoHi(d, `${genGprU32Lo(t)} >>> ${shift}`, 0);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRA(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const shift = ctx.instr_sa();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (tf.kind === 'constant64') {
    impl = genSetRegS32Const(d, Number(BigInt.asIntN(32, tf.value >> BigInt(shift))));
  } else if (shift === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else if (isSigned32(tf)) {
    impl = genSetRegS32Extend(d, `${genGprS32Lo(t)} >> ${shift}`);
  } else if (isUnsigned32(tf)) {
    impl = genSetRegS64LoHi(d, `${genGprU32Lo(t)} >>> ${shift}`, 0);
  } else {
    // VR4300 SRA shifts the full 64-bit register before sign-extending bit 31.
    impl = genSetRegS32Extend(d, `(${genGprU32Lo(t)} >>> ${shift}) | (${genGprU32Hi(t)} << ${32 - shift})`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLLV(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else if (t === 0) {
    impl = genSetRegS32Const(d, 0);
  } else {
    impl = genSetRegS32Extend(d, `${genGprS32Lo(t)} << ${genGprS32Lo(s)}`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRLV(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else if (t === 0) {
    impl = genSetRegS32Const(d, 0);
  } else {
    impl = genSetRegS32Extend(d, `(${genGprU32Lo(t)} >>> ${genGprS32Lo(s)}) | 0`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSRAV(ctx) {
  const d = ctx.instr_rd();
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0) {
    impl = d === t && isSigned32(tf) ? '' : genSetRegS32Extend(d, genGprS32Lo(t));
  } else if (t === 0) {
    impl = genSetRegS32Const(d, 0);
  } else if (isSigned32(tf)) {
    impl = genSetRegS32Extend(d, `${genGprS32Lo(t)} >> ${genGprS32Lo(s)}`);
  } else if (isUnsigned32(tf)) {
    impl = genSetRegS32Extend(d, `(${genGprU32Lo(t)} >>> ${genGprS32Lo(s)}) | 0`);
  } else {
    impl = `c.execSRAV(${d}, ${t}, ${s});`;
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLLV(ctx) {
  const impl = `c.execDSLLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRLV(ctx) {
  const impl = `c.execDSRLV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRAV(ctx) {
  const impl = `c.execDSRAV(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLL(ctx) {
  const impl = `c.execDSLL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSLL32(ctx) {
  const impl = `c.execDSLL32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRL(ctx) {
  const impl = `c.execDSRL(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRL32(ctx) {
  const impl = `c.execDSRL32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRA(ctx) {
  const impl = `c.execDSRA(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSRA32(ctx) {
  const impl = `c.execDSRA32(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_sa()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateRESERVED(ctx) {
  const impl = `c.execRESERVED(0);`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises SYSCALL exception.
}

function generateSYSCALL(ctx) {
  const impl = `c.execSYSCALL();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises SYSCALL exception.
}

function generateBREAK(ctx) {
  const impl = `c.execBREAK();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises BREAK exception.
}

function generateSYNC(ctx) {
  const impl = `c.execSYNC();`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises SYNC exception.
}

function generateTGE(ctx) {
  const impl = `c.execTGE(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTGEU(ctx) {
  const impl = `c.execTGEU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLT(ctx) {
  const impl = `c.execTLT(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLTU(ctx) {
  const impl = `c.execTLTU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTEQ(ctx) {
  const impl = `c.execTEQ(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTNE(ctx) {
  const impl = `c.execTNE(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateMFHI(ctx) {
  const impl = `c.execMFHI(${ctx.instr_rd()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMFLO(ctx) {
  const impl = `c.execMFLO(${ctx.instr_rd()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTHI(ctx) {
  const impl = `c.execMTHI(${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMTLO(ctx) {
  const impl = `c.execMTLO(${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMULT(ctx) {
  const impl = `c.execMULT(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateMULTU(ctx) {
  const impl = `c.execMULTU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDMULT(ctx) {
  const impl = `c.execDMULT(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDMULTU(ctx) {
  const impl = `c.execDMULTU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDIV(ctx) {
  const impl = `c.execDIV(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDIVU(ctx) {
  const impl = `c.execDIVU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDDIV(ctx) {
  const impl = `c.execDDIV(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDDIVU(ctx) {
  const impl = `c.execDDIVU(${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateADD(ctx) {
  const impl = `c.execADD(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDADD(ctx) {
  const impl = `c.execDADD(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateADDU(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (sf.kind === 'constant64' && tf.kind === 'constant64') {
    impl = genSetRegS32Const(d, Number(BigInt.asIntN(32, sf.value + tf.value)));
  } else if (s === 0 || t === 0) {
    const src = s === 0 ? t : s;
    const srcFact = s === 0 ? tf : sf;
    impl = d === src && isSigned32(srcFact) ? '' : genSetRegS32Extend(d, genGprS32Lo(src));
  } else {
    impl = genSetRegS32Extend(d, `(${genGprS32Lo(s)} + ${genGprS32Lo(t)}) | 0`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDADDU(ctx) {
  const impl = `c.execDADDU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSUB(ctx) {
  const impl = `c.execSUB(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDSUB(ctx) {
  const impl = `c.execDSUB(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  // Use the generic boilerplate because we might have generated an overflow exception.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateSUBU(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === t) {
    impl = genSetRegS32Const(d, 0);
  } else if (sf.kind === 'constant64' && tf.kind === 'constant64') {
    impl = genSetRegS32Const(d, Number(BigInt.asIntN(32, sf.value - tf.value)));
  } else if (t === 0) {
    impl = d === s && isSigned32(sf) ? '' : genSetRegS32Extend(d, genGprS32Lo(s));
  } else if (s === 0) {
    impl = genSetRegS32Extend(d, `(-${genGprS32Lo(t)}) | 0`);
  } else {
    impl = genSetRegS32Extend(d, `(${genGprS32Lo(s)} - ${genGprS32Lo(t)}) | 0`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDSUBU(ctx) {
  const impl = `c.execDSUBU(${ctx.instr_rd()}, ${ctx.instr_rt()}, ${ctx.instr_rs()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateAND(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0 || t === 0) {
    impl = genSetRegS32Const(d, 0);
  } else if (s === t) {
    impl = d === s ? '' : genSetRegS64LoHi(d, genGprS32Lo(s), genSrcRegS32Hi(s));
  } else {
    const hi = isUnsigned32(sf) || isUnsigned32(tf) ? 0 : `${genSrcRegS32Hi(s)} & ${genSrcRegS32Hi(t)}`;
    impl = genSetRegS64LoHi(d, `${genGprS32Lo(s)} & ${genGprS32Lo(t)}`, hi);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateOR(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0 || t === 0) {
    const source = s === 0 ? t : s;
    if (source === d) {
      impl = '';
    } else if (source === 0) {
      impl = genSetRegS32Const(d, 0);
    } else {
      impl = genSetRegS64LoHi(d, genGprS32Lo(source), genSrcRegS32Hi(source));
    }
  } else if (s === t) {
    impl = d === s ? '' : genSetRegS64LoHi(d, genGprS32Lo(s), genSrcRegS32Hi(s));
  } else {
    const hi = isUnsigned32(sf) && isUnsigned32(tf) ? 0 : `${genSrcRegS32Hi(s)} | ${genSrcRegS32Hi(t)}`;
    impl = genSetRegS64LoHi(d, `${genGprS32Lo(s)} | ${genGprS32Lo(t)}`, hi);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateXOR(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === t) {
    impl = genSetRegS32Const(d, 0);
  } else if (s === 0 || t === 0) {
    const source = s === 0 ? t : s;
    impl = source === d ? '' : genSetRegS64LoHi(d, genGprS32Lo(source), genSrcRegS32Hi(source));
  } else {
    const hi = isUnsigned32(sf) && isUnsigned32(tf) ? 0 : `${genSrcRegS32Hi(s)} ^ ${genSrcRegS32Hi(t)}`;
    impl = genSetRegS64LoHi(d, `${genGprS32Lo(s)} ^ ${genGprS32Lo(t)}`, hi);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateNOR(ctx) {
  const d = ctx.instr_rd();
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const sf = ctx.gprFacts.get(s);
  const tf = ctx.gprFacts.get(t);
  let impl;
  if (d === 0) {
    impl = '';
  } else if (s === 0 && t === 0) {
    impl = genSetRegS32Const(d, -1);
  } else if (s === 0 || t === 0 || s === t) {
    const src = s === 0 ? t : s;
    const hi = isUnsigned32(ctx.gprFacts.get(src)) ? -1 : `~${genSrcRegS32Hi(src)}`;
    impl = genSetRegS64LoHi(d, `~${genGprS32Lo(src)}`, hi);
  } else {
    const hi = isUnsigned32(sf) && isUnsigned32(tf) ? -1 : `~(${genSrcRegS32Hi(s)} | ${genSrcRegS32Hi(t)})`;
    impl = genSetRegS64LoHi(d, `~(${genGprS32Lo(s)} | ${genGprS32Lo(t)})`, hi);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateSLT(ctx) {
  return generateComparison(ctx, ctx.instr_rd(), ctx.instr_rs(), ctx.instr_rt(), false);
}

function generateSLTU(ctx) {
  return generateComparison(ctx, ctx.instr_rd(), ctx.instr_rs(), ctx.instr_rt(), true);
}

function generateADDI(ctx) {
  const impl = `c.execADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // May raise Overflow exception.
}

function generateDADDI(ctx) {
  const impl = `c.execDADDI(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // May raise Overflow exception.
}

function generateADDIU(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const imms = ctx.instr_imms();
  const sf = ctx.gprFacts.get(s);
  let impl;
  if (t === 0) {
    impl = '';
  } else if (sf.kind === 'constant64') {
    impl = genSetRegS32Const(t, Number(BigInt.asIntN(32, sf.value)) + imms);
  } else if (imms === 0) {
    impl = t === s && isSigned32(sf) ? '' : genSetRegS32Extend(t, genGprS32Lo(s));
  } else {
    impl = genSetRegS32Extend(t, `(${genGprS32Lo(s)} + ${imms}) | 0`);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateDADDIU(ctx) {
  const impl = `c.execDADDIU(${ctx.instr_rt()}, ${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateTrivialOpBoilerplate(impl, ctx);
}

// Cop0
function generateMFC0(ctx) {
  const impl = generateCop0TimingSync(ctx, false) + `c.execMFC0(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDMFC0(ctx) {
  const impl = generateCop0TimingSync(ctx, false) + `c.execDMFC0(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateMTC0(ctx) {
  if (ctx.instr_fs() === cpu0reg.controlStatus) {
    ctx.fragment.cop1statusKnown = false;
  }
  const impl = generateCop0TimingSync(ctx, true) + `c.execMTC0(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateDMTC0(ctx) {
  if (ctx.instr_fs() === cpu0reg.controlStatus) {
    ctx.fragment.cop1statusKnown = false;
  }
  const impl = generateCop0TimingSync(ctx, true) + `c.execDMTC0(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateCop0TimingSync(ctx, write) {
  const reg = ctx.instr_fs();
  if (reg !== cpu0reg.controlCount && !(write && reg === cpu0reg.controlCompare)) {
    return '';
  }
  // Count must include the preceding instructions before it is read or replaced.
  // Writes can schedule an event inside the remainder of this fragment, so return
  // after the write and recheck the event deadline before executing more code.
  if (write) {
    ctx.bailOut = true;
    return ''; // The bailout preflight synchronizes both Count and event time.
  }
  return `${ctx.genSyncFragmentCycles()}\n`;
}

function generateTLB(ctx) {
  const impl = `c.execTLB(${ctx.instr_tlbop()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

// Cop2
function generateMFC2(ctx) {
  const impl = `c.execMFC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateDMFC2(ctx) {
  const impl = `c.execDMFC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateCFC2(ctx) {
  const impl = `c.execCFC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateDCFC2(ctx) {
  const impl = `c.execDCFC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateMTC2(ctx) {
  const impl = `c.execMTC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateDMTC2(ctx) {
  const impl = `c.execDMTC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateCTC2(ctx) {
  const impl = `c.execCTC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateDCTC2(ctx) {
  const impl = `c.execDCTC2(${ctx.instr_rt()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise Cop Unusable exception.
}

function generateSpeedHack(ctx) {
  // Retain cycle synchronization and the fragment boundary even when the
  // shortcut is omitted: active RSP instructions can schedule new events.
  ctx.bailOut = true;
  // A rotated self-loop can already contain its branch's delay slot. If that
  // recorded instruction is non-NOP, speedHack would always reject it. Omitting
  // the call avoids repeatedly reading guest memory to rediscover that fact.
  // Use only traced instructions: they participate in I-cache invalidation and
  // revalidation. An unobserved delay slot still needs the runtime check.
  const index = ctx.fragment.instructionPCs.lastIndexOf(ctx.pc + 4);
  return index >= 0 && ctx.fragment.instructionWords[index] !== 0 ? '' : 'c.speedHack();\n';
}

// Jump
function generateJ(ctx) {
  // TODO: can this call execJ? It would need reworking to use branchTarget.
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  let impl = '';
  if (kSpeedHackEnabled && addr === ctx.pc) {
    impl += generateSpeedHack(ctx);
  }
  impl += 'c.delayPC = ' + toString32(addr) + ';';
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJAL(ctx) {
  // TODO: can this call execJAL? It would need reworking to use branchTarget.
  const addr = jumpAddress(ctx.pc, ctx.instruction);
  const ra = ctx.nextPC + 4;
  // Optimise as sign is known at compile time.
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  const impl = `c.delayPC = ${toString32(addr)};\n${genSetRegS64LoHi(cpu0reg.RA, toString32(ra), ra_hi)}`;
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJALR(ctx) {
  // TODO: can this call execJALR? It would need reworking to use branchTarget.
  const s = ctx.instr_rs();
  const d = ctx.instr_rd();

  const ra = ctx.nextPC + 4;
  const ra_hi = (ra & 0x80000000) ? -1 : 0;
  // NB needs to be unsigned
  const setLink = genSetRegS64LoHi(d, toString32(ra), ra_hi);
  const impl = `c.delayPC = ${genSrcRegU32Lo(s)};${setLink ? `\n${setLink}` : ''}`;
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateJR(ctx) {
  // TODO: can this call execJR? It would need reworking to use branchTarget.
  // NB needs to be unsigned
  const impl = `c.delayPC = ${genSrcRegU32Lo(ctx.instr_rs())};`;
  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBEQ(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const off = ctx.instr_offset();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  let impl = '';

  if (s === t) {
    if (kSpeedHackEnabled && off === -1) {
      impl += generateSpeedHack(ctx);
    }
    impl += `c.delayPC = ${toString32(addr)};\n`;
  } else {
    impl += `if (${genEquality(ctx, s, t, true)}) {\n`;
    if (kSpeedHackEnabled && off === -1) {
      impl += generateSpeedHack(ctx);
    }
    impl += `  c.delayPC = ${toString32(addr)};\n`;
    impl += '} else {\n';
    impl += `  c.delayPC = ${toString32(ctx.pc + 8)};\n`;
    impl += '}\n';
  }

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBEQL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genEquality(ctx, s, t, true)}) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function generateBNE(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const off = ctx.instr_offset();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  let impl = '';
  impl += `if (${genEquality(ctx, s, t, false)}) {\n`;
  if (kSpeedHackEnabled && off === -1) {
    impl += generateSpeedHack(ctx);
  }
  impl += `  c.delayPC = ${toString32(addr)};\n`;
  impl += '} else {\n';
  impl += `  c.delayPC = ${toString32(ctx.pc + 8)};\n`;
  impl += '}\n';

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBNEL(ctx) {
  const s = ctx.instr_rs();
  const t = ctx.instr_rt();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genEquality(ctx, s, t, false)}) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }
      `);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

// Branch Less Than or Equal To Zero
function generateBLEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (!(${genIsPositive(ctx, s)})) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.delayPC = ${toString32(ctx.pc + 8)};
      }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

// Branch Less Than or Equal To Zero Likely
function generateBLEZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (!(${genIsPositive(ctx, s)})) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

// Branch Greater Than Zero
function generateBGTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genIsPositive(ctx, s)}) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.delayPC = ${toString32(ctx.pc + 8)};
      }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

// Branch Greater Than Zero Likely
function generateBGTZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genIsPositive(ctx, s)}) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

// Branch Less Than Zero
function generateBLTZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genSrcRegS32Hi(s)} < 0) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.delayPC = ${toString32(ctx.pc + 8)};
      }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBLTZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genSrcRegS32Hi(s)} < 0) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

// Branch Greater Than Zero
function generateBGEZ(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genSrcRegS32Hi(s)} >= 0) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.delayPC = ${toString32(ctx.pc + 8)};
      }`);

  return generateBranchOpBoilerplate(impl, ctx, false);
}

function generateBGEZL(ctx) {
  const s = ctx.instr_rs();
  const addr = branchAddress(ctx.pc, ctx.instruction);

  const impl = dedent(`
      if (${genSrcRegS32Hi(s)} >= 0) {
        c.delayPC = ${toString32(addr)};
      } else {
        c.nextPC += 4;
      }`);

  return generateBranchOpBoilerplate(impl, ctx, true /* might_adjust_next_pc*/);
}

function generateBLTZAL(ctx) {
  // TODO: implement as generateBranchOpBoilerplate.
  const impl = `c.execBLTZAL(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateBGEZAL(ctx) {
  // TODO: implement as generateBranchOpBoilerplate.
  const impl = `c.execBGEZAL(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateBLTZALL(ctx) {
  // TODO: implement as generateBranchOpBoilerplate.
  const impl = `c.execBLTZALL(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateBGEZALL(ctx) {
  // TODO: implement as generateBranchOpBoilerplate.
  const impl = `c.execBGEZALL(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateTGEI(ctx) {
  const impl = `c.execTGEI(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTGEIU(ctx) {
  const impl = `c.execTGEIU(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLTI(ctx) {
  const impl = `c.execTLTI(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTLTIU(ctx) {
  const impl = `c.execTLTIU(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTEQI(ctx) {
  const impl = `c.execTEQI(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateTNEI(ctx) {
  const impl = `c.execTNEI(${ctx.instr_rs()}, ${ctx.instr_imms()});`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as may raise TRAP exception.
}

function generateSLTI(ctx) {
  return generateComparison(ctx, ctx.instr_rt(), ctx.instr_rs(), 0, false, ctx.instr_imms());
}

function generateSLTIU(ctx) {
  return generateComparison(ctx, ctx.instr_rt(), ctx.instr_rs(), 0, true, ctx.instr_imms());
}

function generateANDI(ctx) {
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const imm = ctx.instr_imm();
  const sf = ctx.gprFacts.get(s);
  let impl;
  if (t === 0) {
    impl = '';
  } else if (sf.kind === 'constant64') {
    impl = genSetRegS64LoHi(t, Number(BigInt.asIntN(32, sf.value)) & imm, 0);
  } else {
    impl = genSetRegS64LoHi(t, `${genGprS32Lo(s)} & ${imm}`, 0);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateORI(ctx) {
  return generateLogicalImmediate(ctx, '|');
}

function generateXORI(ctx) {
  return generateLogicalImmediate(ctx, '^');
}

function generateLogicalImmediate(ctx, op) {
  const t = ctx.instr_rt();
  const s = ctx.instr_rs();
  const imm = ctx.instr_imm();
  const sf = ctx.gprFacts.get(s);
  let impl;
  if (t === 0) {
    impl = '';
  } else if (sf.kind === 'constant64') {
    const val = op === '|' ? (sf.value | BigInt(imm)) : (sf.value ^ BigInt(imm));
    impl = genSetRegS64LoHi(t, Number(BigInt.asIntN(32, val)), Number(BigInt.asIntN(32, val >> 32n)));
  } else if (imm === 0) {
    impl = t === s ? '' : genSetRegS64LoHi(t, genGprS32Lo(s), genSrcRegS32Hi(s));
  } else if (t === s) {
    impl = `c.gprS32[${t * 2}] ${op}= ${imm};`;
  } else {
    const hi = isUnsigned32(sf) ? 0 : genSrcRegS32Hi(s);
    impl = genSetRegS64LoHi(t, `${genGprS32Lo(s)} ${op} ${imm}`, hi);
  }
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateLUI(ctx) {
  const impl = genSetRegS32Const(ctx.instr_rt(), ctx.instr_imm() << 16);
  return generateTrivialOpBoilerplate(impl, ctx);
}

function generateLB(ctx) {
  const impl = `c.execLB(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLBU(ctx) {
  const impl = `c.execLBU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLH(ctx) {
  const impl = `c.execLH(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLHU(ctx) {
  const impl = `c.execLHU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLW(ctx) {
  const impl = `c.execLW(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLWU(ctx) {
  const impl = `c.execLWU(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLD(ctx) {
  const impl = `c.execLD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLWL(ctx) {
  const impl = `c.execLWL(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLWR(ctx) {
  const impl = `c.execLWR(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLDL(ctx) {
  const impl = `c.execLDL(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLDR(ctx) {
  const impl = `c.execLDR(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

// Status writes invalidate cop1statusKnown. Keep the shared instruction helpers
// and only skip their usability check once COP1 is known to be enabled.
function generateCop1MemoryAccess(op, ctx) {
  ctx.fragment.usesCop1 = true;
  const unchecked = ctx.fragment.cop1statusKnown;
  const suffix = unchecked ? 'Unchecked' : '';
  const impl = `c.exec${op}${suffix}(${ctx.instr_ft()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  ctx.fragment.cop1statusKnown = true;
  if (unchecked) {
    return generateMemoryAccessBoilerplate(impl, ctx, uncheckedCop1MemoryEffects);
  }
  // A usability exception can redirect execution and return normally.
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateLWC1(ctx) {
  return generateCop1MemoryAccess('LWC1', ctx);
}

function generateLDC1(ctx) {
  return generateCop1MemoryAccess('LDC1', ctx);
}

function generateLWC2(ctx) {
  const impl = `c.execLWC2(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLDC2(ctx) {
  const impl = `c.execLDC2(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSB(ctx) {
  const impl = `c.execSB(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSH(ctx) {
  const impl = `c.execSH(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSW(ctx) {
  const impl = `c.execSW(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSD(ctx) {
  const impl = `c.execSD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSWL(ctx) {
  const impl = `c.execSWL(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSWR(ctx) {
  const impl = `c.execSWR(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSDL(ctx) {
  const impl = `c.execSDL(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSDR(ctx) {
  const impl = `c.execSDR(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSWC1(ctx) {
  return generateCop1MemoryAccess('SWC1', ctx);
}

function generateSDC1(ctx) {
  return generateCop1MemoryAccess('SDC1', ctx);
}

function generateSWC2(ctx) {
  const impl = `c.execSWC2(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateSDC2(ctx) {
  const impl = `c.execSDC2(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx);
}

function generateLL(ctx) {
  const impl = `c.execLL(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateLLD(ctx) {
  const impl = `c.execLLD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSC(ctx) {
  const impl = `c.execSC(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateSCD(ctx) {
  const impl = `c.execSCD(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
  return generateMemoryAccessBoilerplate(impl, ctx, integerMemoryEffects);
}

function generateCACHE(ctx) {
  if (!n64js.cpu0.ignoreCacheOp(ctx.instr_rt())) {
    // Invalidating the stored function cannot stop an invocation in progress.
    // Publish PC/delay state and return before executing any more cached code.
    ctx.bailOut = true;
    const impl = `c.execCACHE(${ctx.instr_rt()}, ${ctx.instr_base()}, ${ctx.instr_imms()});`;
    return generateGenericOpBoilerplate(impl, ctx);
  } else {
    return generateNOPBoilerplate('CACHE (ignored)', ctx);
  }
}



function generateMFC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;
  return `c.execMFC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateDMFC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;
  return `c.execDMFC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateMTC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;
  return `c.execMTC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateDMTC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;
  return `c.execDMTC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateCFC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = true;
  return `c.execCFC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateCTC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false; // Writing FCSR can raise FPE.
  return `c.execCTC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateDCFC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false; // Raises FPE Unimplemented exception.
  return `c.execDCFC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateDCTC1(ctx) {
  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false; // Raises FPE Unimplemented exception.
  return `c.execDCTC1(${ctx.instr_rt()}, ${ctx.instr_fs()});`;
}

function generateCop1Reserved(ctx) {
  ctx.isTrivial = false;
  return `cpu1.raiseUnimplemented();`;
}

function generateBCInstrStub(ctx) {
  const i = ctx.instruction;
  if (((i >>> 18) & 0x7) !== 0) {
    return generateCop1Reserved(ctx);
  }

  const condition = (i & 0x10000) !== 0;
  const likely = (i & 0x20000) !== 0;
  const target = branchAddress(ctx.pc, i);

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false; // NB: not trivial - branches!

  const test = condition ? '!==' : '===';

  let impl = `const cond = (cpu1.control[31] & FPCSR_C) ${test} 0;\n`;
  if (likely) {
    impl += `if (cond) {\n`;
    impl += `  c.branchTarget = ${toString32(target)};\n`;
    impl += '} else {\n';
    impl += '  c.nextPC += 4;\n';
    impl += '}\n';
  } else {
    impl += `if (cond) {\n`;
    impl += `  c.branchTarget = ${toString32(target)};\n`;
    impl += '} else {\n';
    impl += `  c.branchTarget = ${toString32(ctx.pc + 8)};\n`;
    impl += '}\n';
  }
  return impl;
}

function generateSInstrStub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_ft();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.

  const op = copFmtFuncOp(ctx.instruction);
  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_S(${d}, ${s}, ${t});`;
      case cop1SUB: return `cpu1.SUB_S(${d}, ${s}, ${t});`;
      case cop1MUL: return `cpu1.MUL_S(${d}, ${s}, ${t});`;
      case cop1DIV: return `cpu1.DIV_S(${d}, ${s}, ${t});`;
      case cop1SQRT: return `cpu1.SQRT_S(${d}, ${s});`;
      case cop1ABS: return `cpu1.ABS_S(${d}, ${s});`;
      case cop1MOV: return `cpu1.MOV_S(${d}, ${s});`;
      case cop1NEG: return `cpu1.NEG_S(${d}, ${s});`;
      case cop1ROUND_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_L: return `cpu1.ConvertSToL(${d}, ${s}, ${convertModeFloor});`;
      case cop1ROUND_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_W: return `cpu1.ConvertSToW(${d}, ${s}, ${convertModeFloor});`;
      case cop1CVT_S: return `cpu1.raiseUnimplemented();`;
      case cop1CVT_D: return `cpu1.CVT_D_S(${d}, ${s});`;
      case cop1CVT_W: return `cpu1.ConvertSToW(${d}, ${s}, cpu1.roundingMode);`;
      case cop1CVT_L: return `cpu1.ConvertSToL(${d}, ${s}, cpu1.roundingMode);`;
    }

    return `cpu1.raiseUnimplemented();`;
  }

  return `cpu1.handleFloatCompareSingle(${op}, ${s}, ${t});`;
}

function generateDInstrStub(ctx) {
  const s = ctx.instr_fs();
  const t = ctx.instr_ft();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.

  const op = copFmtFuncOp(ctx.instruction);
  if (op < 0x30) {
    switch (op) {
      case cop1ADD: return `cpu1.ADD_D(${d}, ${s}, ${t});`;
      case cop1SUB: return `cpu1.SUB_D(${d}, ${s}, ${t});`;
      case cop1MUL: return `cpu1.MUL_D(${d}, ${s}, ${t});`;
      case cop1DIV: return `cpu1.DIV_D(${d}, ${s}, ${t});`;
      case cop1SQRT: return `cpu1.SQRT_D(${d}, ${s});`;
      case cop1ABS: return `cpu1.ABS_D(${d}, ${s});`;
      case cop1MOV: return `cpu1.MOV_D(${d}, ${s});`;
      case cop1NEG: return `cpu1.NEG_D(${d}, ${s});`;
      case cop1ROUND_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_L: return `cpu1.ConvertDToL(${d}, ${s}, ${convertModeFloor});`;
      case cop1ROUND_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeRound});`;
      case cop1TRUNC_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeTrunc});`;
      case cop1CEIL_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeCeil});`;
      case cop1FLOOR_W: return `cpu1.ConvertDToW(${d}, ${s}, ${convertModeFloor});`;
      case cop1CVT_S: return `cpu1.CVT_S_D(${d}, ${s});`;
      case cop1CVT_D: return `cpu1.raiseUnimplemented();`;
      case cop1CVT_W: return `cpu1.ConvertDToW(${d}, ${s}, cpu1.roundingMode);`;
      case cop1CVT_L: return `cpu1.ConvertDToL(${d}, ${s}, cpu1.roundingMode);`;
    }
    return `cpu1.raiseUnimplemented();`;
  }

  return `cpu1.handleFloatCompareDouble(${op}, ${s}, ${t});`;
}

function generateWInstrStub(ctx) {
  const s = ctx.instr_fs();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.
  switch (copFmtFuncOp(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_S: return `cpu1.CVT_S_W(${d}, ${s});`;
    case cop1CVT_D: return `cpu1.CVT_D_W(${d}, ${s});`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();`;
  }
  return `cpu1.raiseUnimplemented();`;
}

function generateLInstrStub(ctx) {
  const s = ctx.instr_fs();
  const d = ctx.instr_fd();

  ctx.fragment.usesCop1 = true;
  ctx.isTrivial = false;  // Can raise FPE.
  switch (copFmtFuncOp(ctx.instruction)) {
    case cop1ROUND_L: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_L: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_L: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_L: return `cpu1.raiseUnimplemented();`;
    case cop1ROUND_W: return `cpu1.raiseUnimplemented();`;
    case cop1TRUNC_W: return `cpu1.raiseUnimplemented();`;
    case cop1CEIL_W: return `cpu1.raiseUnimplemented();`;
    case cop1FLOOR_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_S: return `cpu1.CVT_S_L(${d}, ${s});`;
    case cop1CVT_D: return `cpu1.CVT_D_L(${d}, ${s});`;
    case cop1CVT_W: return `cpu1.raiseUnimplemented();`;
    case cop1CVT_L: return `cpu1.raiseUnimplemented();`;
  }
  return `cpu1.raiseUnimplemented();`;
}

function generateCop1(ctx) {
  const fn = cop1TableGen[copOp(ctx.instruction)];

  const opImpl = fn(ctx);

  let impl = '';

  ctx.fragment.usesCop1 = true;

  if (ctx.fragment.cop1statusKnown) {
    // Assert that cop1 is enabled
    impl += ctx.genAssert('(c.getControlU32(12) & SR_CU1) !== 0', 'cop1 should be enabled');
    impl += addNewlines(opImpl);
  } else {
    impl += 'if( (c.getControlU32(12) & SR_CU1) === 0 ) {\n';
    impl += `  n64js.executeCop1_disabled(${toString32(ctx.instruction)});\n`;
    impl += '} else {\n';
    impl += '  ' + addNewlines(opImpl);
    impl += '}\n';

    ctx.isTrivial = false;    // Not trivial!
    ctx.fragment.cop1statusKnown = true;
    return generateGenericOpBoilerplate(impl, ctx);   // Ensure we generate full boilerplate here, even for trivial ops
  }

  if (ctx.isTrivial) {
    return generateTrivialOpBoilerplate(impl, ctx);
  }
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateBreakpoint(ctx) {
  const impl = `n64js.breakpoints().isBreakpoint(c.pc) ? c.execBreakpoint() : c.execRESERVED(0);`;
  return generateGenericOpBoilerplate(impl, ctx);
}

function validateSpecialOpTable(cases) {
  if (cases.length != 64) {
    throw "Special table is unexpected size.";
  }
  return cases;
}

function validateCopOpTable(cases) {
  if (cases.length != 32) {
    throw "Cop table is unexpected size.";
  }
  return cases;
}

function validateRegImmOpTable(cases) {
  if (cases.length != 32) {
    throw "RegImm table is unexpected size.";
  }
  return cases;
}

function validateSimpleOpTable(cases) {
  if (cases.length != 64) {
    throw "Simple table is unexpected size.";
  }
  return cases;
}

const specialTableGen = validateSpecialOpTable([
  generateSLL,       generateRESERVED,  generateSRL,     generateSRA,
  generateSLLV,      generateRESERVED,  generateSRLV,    generateSRAV,
  generateJR,        generateJALR,      generateRESERVED, generateRESERVED,
  generateSYSCALL,   generateBREAK,     generateRESERVED, generateSYNC,
  generateMFHI,      generateMTHI,      generateMFLO,    generateMTLO,
  generateDSLLV,     generateRESERVED,  generateDSRLV,   generateDSRAV,
  generateMULT,      generateMULTU,     generateDIV,     generateDIVU,
  generateDMULT,     generateDMULTU,    generateDDIV,    generateDDIVU,
  generateADD,       generateADDU,      generateSUB,     generateSUBU,
  generateAND,       generateOR,        generateXOR,     generateNOR,
  generateRESERVED,  generateRESERVED,  generateSLT,     generateSLTU,
  generateDADD,      generateDADDU,     generateDSUB,    generateDSUBU,
  generateTGE,       generateTGEU,      generateTLT,     generateTLTU,
  generateTEQ,       generateRESERVED,  generateTNE,     generateRESERVED,
  generateDSLL,      generateRESERVED,  generateDSRL,    generateDSRA,
  generateDSLL32,    generateRESERVED,  generateDSRL32,  generateDSRA32,
]);
const cop1TableGen = validateCopOpTable([
  generateMFC1,         generateDMFC1,       generateCFC1,         generateDCFC1,
  generateMTC1,         generateDMTC1,       generateCTC1,         generateDCTC1,
  generateBCInstrStub,  generateCop1Reserved, generateCop1Reserved, generateCop1Reserved,
  generateCop1Reserved, generateCop1Reserved, generateCop1Reserved, generateCop1Reserved,
  generateSInstrStub,   generateDInstrStub,  generateCop1Reserved, generateCop1Reserved,
  generateWInstrStub,   generateLInstrStub,  generateCop1Reserved, generateCop1Reserved,
  generateCop1Reserved, generateCop1Reserved, generateCop1Reserved, generateCop1Reserved,
  generateCop1Reserved, generateCop1Reserved, generateCop1Reserved, generateCop1Reserved,
]);

const cop2TableGen = validateCopOpTable([
  generateMFC2,    generateDMFC2,   generateCFC2,    generateDCFC2,
  generateMTC2,    generateDMTC2,   generateCTC2,    generateDCTC2,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
  generateUnknown, generateUnknown, generateUnknown, generateUnknown,
]);


const regImmTableGen = validateRegImmOpTable([
  generateBLTZ,     generateBGEZ,     generateBLTZL,    generateBGEZL,
  generateRESERVED, generateRESERVED, generateRESERVED, generateRESERVED,
  generateTGEI,    generateTGEIU,   generateTLTI,    generateTLTIU,
  generateTEQI,     generateRESERVED, generateTNEI,     generateRESERVED,
  generateBLTZAL,  generateBGEZAL,  generateBLTZALL, generateBGEZALL,
  generateRESERVED, generateRESERVED, generateRESERVED, generateRESERVED,
  generateRESERVED, generateRESERVED, generateRESERVED, generateRESERVED,
  generateRESERVED, generateRESERVED, generateRESERVED, generateRESERVED,
]);


const simpleTableGen = validateSimpleOpTable([
  generateSpecial,    generateRegImm,  generateJ,       generateJAL,
  generateBEQ,        generateBNE,     generateBLEZ,    generateBGTZ,
  generateADDI,       generateADDIU,   generateSLTI,    generateSLTIU,
  generateANDI,       generateORI,     generateXORI,    generateLUI,
  generateCop0,       generateCop1,    generateCop2,    generateCop3,
  generateBEQL,       generateBNEL,    generateBLEZL,   generateBGTZL,
  generateDADDI,      generateDADDIU,  generateLDL,     generateLDR,
  generateBreakpoint, generateRESERVED, generateRESERVED, generateRESERVED,
  generateLB,         generateLH,      generateLWL,     generateLW,
  generateLBU,        generateLHU,     generateLWR,     generateLWU,
  generateSB,         generateSH,      generateSWL,     generateSW,
  generateSDL,        generateSDR,     generateSWR,     generateCACHE,
  generateLL,         generateLWC1,    generateLWC2,    generateRESERVED,
  generateLLD,        generateLDC1,    generateLDC2,    generateLD,
  generateSC,         generateSWC1,    generateSWC2,    generateRESERVED,
  generateSCD,        generateSDC1,    generateSDC2,    generateSD
]);



function generateOp(ctx) {
  if (kUseOptimisedDynarecHandlers) {
    return simpleTableGen[simpleOp(ctx.instruction)](ctx);
  }
  const impl = `n64js.executeOp(${ctx.instruction});`
  return generateGenericOpBoilerplate(impl, ctx);
}

function generateSpecial(ctx) {
  return specialTableGen[specialOp(ctx.instruction)](ctx);
}

function generateRegImm(ctx) {
  return regImmTableGen[regImmOp(ctx.instruction)](ctx);
}

function generateCop0(ctx) {
  // Retain the trivial WAIT path; all other CO=1 encodings use funct alone.
  if (isWait(ctx.instruction)) {
    return generateNOPBoilerplate('WAIT', ctx);
  }
  if (ctx.instruction & 0x02000000) {
    return generateTLB(ctx);
  }
  switch (copOp(ctx.instruction)) {
    case 0: return generateMFC0(ctx);
    case 1: return generateDMFC0(ctx);
    case 4: return generateMTC0(ctx);
    case 5: return generateDMTC0(ctx);
    case 2: case 6: case 8:
      return generateNOPBoilerplate('Inert COP0 instruction', ctx);
    default: return generateRESERVED(ctx);
  }
}

function generateCop2(ctx) {
  return cop2TableGen[copOp(ctx.instruction)](ctx);
}

function generateCop3(ctx) {
  const impl = `c.execRESERVED(0);`;
  return generateGenericOpBoilerplate(impl, ctx); // Generic as raises RESERVED exception.
}

// Expose functions to dynarec.
// TODO: consider sticking all these in a single namespace.
window.n64jsAssert = (cond, msg) => {
  assert(cond, msg);
};
