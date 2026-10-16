import { describe, expect, test } from 'bun:test';
import { compileOp, regimm } from './test_helpers.js';

const reservedMainOpcodes = [0x13, 0x1c, 0x1d, 0x1e, 0x1f, 0x33, 0x3b];
const reservedSpecialFunctions = [
  0x01, 0x05, 0x0a, 0x0b, 0x0e, 0x15, 0x28, 0x29, 0x35, 0x37, 0x39, 0x3d,
];
const reservedRegImmSelectors = [
  0x04, 0x05, 0x06, 0x07, 0x0d, 0x0f, 0x14, 0x15, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];

describe('reserved integer recompilation', () => {
  test('raises RI for every reserved integer encoding', () => {
    const instructions = [
      ...reservedMainOpcodes.map(op => op << 26),
      ...reservedSpecialFunctions,
      ...reservedRegImmSelectors.map(rt => regimm(rt, 0)),
    ];

    for (const instruction of instructions) {
      expect(compileOp(instruction, { pc: 0x80000000 }).bodyCode).toContain('c.execRESERVED(0);');
    }
  });
});
