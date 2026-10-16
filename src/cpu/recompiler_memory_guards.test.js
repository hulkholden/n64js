import { describe, expect, test } from 'bun:test';
import * as decode from './decode.js';
import {
  DEFAULT_PC,
  compileOp,
  iop,
} from './test_helpers.js';

const integerOps = [
  ['LB', decode.OP_LB], ['LBU', decode.OP_LBU], ['LH', decode.OP_LH], ['LHU', decode.OP_LHU],
  ['LW', decode.OP_LW], ['LWU', decode.OP_LWU], ['LD', decode.OP_LD], ['LWL', decode.OP_LWL],
  ['LWR', decode.OP_LWR], ['LDL', decode.OP_LDL], ['LDR', decode.OP_LDR],
  ['SB', decode.OP_SB], ['SH', decode.OP_SH], ['SW', decode.OP_SW], ['SD', decode.OP_SD],
  ['SWL', decode.OP_SWL], ['SWR', decode.OP_SWR], ['SDL', decode.OP_SDL], ['SDR', decode.OP_SDR],
  ['LL', decode.OP_LL], ['LLD', decode.OP_LLD], ['SC', decode.OP_SC], ['SCD', decode.OP_SCD],
];

const cop1MemoryOps = [
  ['LWC1', decode.OP_LWC1], ['LDC1', decode.OP_LDC1],
  ['SWC1', decode.OP_SWC1], ['SDC1', decode.OP_SDC1],
];

const copMemoryOps = [
  ...cop1MemoryOps,
  ['LWC2', decode.OP_LWC2], ['LDC2', decode.OP_LDC2],
  ['SWC2', decode.OP_SWC2], ['SDC2', decode.OP_SDC2],
];

function generate(opcode, needsDelayCheck, postPC = DEFAULT_PC + 4, cop1statusKnown = false) {
  return compileOp(iop(opcode, 4, 2), { postPC, nextPC: postPC, needsDelayCheck, cop1statusKnown }).bodyCode;
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
});
