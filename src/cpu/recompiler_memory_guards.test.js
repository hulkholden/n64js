import { describe, expect, test } from 'bun:test';
import * as decode from './decode.js';
import { Fragment } from './fragments.js';
import { FragmentContext, emitTraceStep, finishCodeGeneration } from './recompiler.js';
import {
  DEFAULT_PC,
  compileOp,
  iop,
} from './test_helpers.js';

const integerLoadOps = [
  ['LB', decode.OP_LB], ['LBU', decode.OP_LBU], ['LH', decode.OP_LH], ['LHU', decode.OP_LHU],
  ['LW', decode.OP_LW], ['LWU', decode.OP_LWU], ['LD', decode.OP_LD], ['LWL', decode.OP_LWL],
  ['LWR', decode.OP_LWR], ['LDL', decode.OP_LDL], ['LDR', decode.OP_LDR],
  ['LL', decode.OP_LL], ['LLD', decode.OP_LLD],
];

const integerStoreOps = [
  ['SB', decode.OP_SB], ['SH', decode.OP_SH], ['SW', decode.OP_SW], ['SD', decode.OP_SD],
  ['SWL', decode.OP_SWL], ['SWR', decode.OP_SWR], ['SDL', decode.OP_SDL], ['SDR', decode.OP_SDR],
  ['SC', decode.OP_SC], ['SCD', decode.OP_SCD],
];

const integerOps = [...integerLoadOps, ...integerStoreOps];

const cop1LoadOps = [
  ['LWC1', decode.OP_LWC1], ['LDC1', decode.OP_LDC1],
];

const cop1StoreOps = [
  ['SWC1', decode.OP_SWC1], ['SDC1', decode.OP_SDC1],
];

const cop1MemoryOps = [...cop1LoadOps, ...cop1StoreOps];

const cop2LoadOps = [
  ['LWC2', decode.OP_LWC2], ['LDC2', decode.OP_LDC2],
];

const cop2StoreOps = [
  ['SWC2', decode.OP_SWC2], ['SDC2', decode.OP_SDC2],
];

const copMemoryOps = [
  ...cop1MemoryOps,
  ...cop2LoadOps,
  ...cop2StoreOps,
];

function generate(opcode, needsDelayCheck, postPC = DEFAULT_PC + 4, cop1statusKnown = false) {
  return compileOp(iop(opcode, 4, 2), { postPC, nextPC: postPC, needsDelayCheck, cop1statusKnown }).bodyCode;
}

function generateTraceStep(opcode, { needsDelayCheck = false, cop1statusKnown = false } = {}) {
  const fragment = new Fragment(DEFAULT_PC);
  fragment.opsCompiled = 1;
  fragment.needsDelayCheck = needsDelayCheck;
  fragment.cop1statusKnown = cop1statusKnown;
  const ctx = new FragmentContext();
  emitTraceStep(fragment, {
    pc: DEFAULT_PC,
    instruction: iop(opcode, 4, 2),
    postPC: DEFAULT_PC + 4,
    nextPC: DEFAULT_PC + 4,
  }, ctx);
  finishCodeGeneration(ctx);
  return fragment.bodyCode;
}

describe('recompiler memory guards', () => {
  for (const [name, opcode] of cop1MemoryOps) {
    test(`unchecked ${name} omits only the proven sequential guard`, () => {
      const source = generate(opcode, false, DEFAULT_PC + 4, true);
      expect(source).toContain(`c.exec${name}Unchecked(2, 4, 0);`);
      expect(source).not.toContain('c.branchTarget');
      expect(source).not.toContain('if (c.pc !==');
      expect(source).toContain('c.fragmentOps = 0;');
      expect(source).toContain('c.nextPC = 0x80001004;');
      expect(source).toContain('c.pc = c.nextPC;');
      expect(source).toContain('c.delayPC = null;');
      expect(source).toContain('if (c.stuffToDo)');
      expect(generate(opcode, true, DEFAULT_PC + 4, true)).toContain('if (c.pc !== 0x80001004)');
      expect(generate(opcode, false, DEFAULT_PC + 8, true)).toContain('if (c.pc !== 0x80001008)');
    });
  }

  for (const [name, opcode] of integerOps) {
    test(`${name} omits only the proven sequential guard`, () => {
      const source = generate(opcode, false);
      expect(source).not.toContain('if (c.pc !==');
      expect(source).toContain('c.nextPC = 0x80001004;');
      expect(source).toContain('c.pc = c.nextPC;');
      expect(source).toContain('c.fragmentOps = 0;');
      expect(source).toContain('if (c.stuffToDo)');
      expect(generate(opcode, true)).toContain('if (c.pc !== 0x80001004)');
      expect(generate(opcode, false, DEFAULT_PC + 8)).toContain('if (c.pc !== 0x80001008)');
    });
  }

  for (const [name, opcode] of copMemoryOps) {
    test(`${name} retains its guard`, () => {
      expect(generate(opcode, false)).toContain('if (c.pc !== 0x80001004)');
    });
  }

  for (const [name, opcode] of [...integerLoadOps, ...cop2LoadOps]) {
    test(`${name} does not refresh rspHalted after the load`, () => {
      const source = generateTraceStep(opcode);
      expect(source.match(/rspHalted = rsp\.halted;/g)).toHaveLength(1);
    });
  }

  for (const [name, opcode] of cop1LoadOps) {
    for (const cop1statusKnown of [false, true]) {
      test(`${name} (cop1statusKnown=${cop1statusKnown}) does not refresh rspHalted after the load`, () => {
        const source = generateTraceStep(opcode, { cop1statusKnown });
        expect(source.match(/rspHalted = rsp\.halted;/g)).toHaveLength(1);
      });
    }
  }

  for (const [name, opcode] of [...integerStoreOps, ...cop2StoreOps]) {
    for (const needsDelayCheck of [false, true]) {
      test(`${name} (needsDelayCheck=${needsDelayCheck}) refreshes rspHalted after the store`, () => {
        const source = generateTraceStep(opcode, { needsDelayCheck });
        expect(source.match(/rspHalted = rsp\.halted;/g)).toHaveLength(2);
      });
    }
  }

  for (const [name, opcode] of cop1StoreOps) {
    for (const cop1statusKnown of [false, true]) {
      test(`${name} (cop1statusKnown=${cop1statusKnown}) refreshes rspHalted after the store`, () => {
        const source = generateTraceStep(opcode, { cop1statusKnown });
        expect(source.match(/rspHalted = rsp\.halted;/g)).toHaveLength(2);
      });
    }
  }
});
