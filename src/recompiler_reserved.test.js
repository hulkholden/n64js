import { describe, expect, test } from 'bun:test';

globalThis.window = globalThis.window ?? globalThis;
globalThis.n64js = globalThis.n64js ?? {};
globalThis.n64js.getSyncFlow = () => null;

const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');

const reservedMainOpcodes = [0x13, 0x1c, 0x1d, 0x1e, 0x1f, 0x33, 0x3b];
const reservedSpecialFunctions = [
  0x01, 0x05, 0x0a, 0x0b, 0x0e, 0x15, 0x28, 0x29, 0x35, 0x37, 0x39, 0x3d,
];
const reservedRegImmSelectors = [
  0x04, 0x05, 0x06, 0x07, 0x0d, 0x0f, 0x14, 0x15, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];

function generateInstruction(instruction) {
  const fragment = {
    needsDelayCheck: true,
    bodyCode: '',
    bailedOut: false,
    usesCop1: false,
    opsCompiled: 1,
  };
  const context = new FragmentContext();
  context.newFragment();
  context.set(fragment, 0x80000000, instruction, 0x80000004, 0x80000004);
  generateCodeForOp(context);
  return fragment.bodyCode;
}

describe('reserved integer recompilation', () => {
  test('raises RI for every reserved integer encoding', () => {
    const instructions = [
      ...reservedMainOpcodes.map(op => op << 26),
      ...reservedSpecialFunctions,
      ...reservedRegImmSelectors.map(rt => (0x01 << 26) | (rt << 16)),
    ];

    for (const instruction of instructions) {
      expect(generateInstruction(instruction)).toContain('c.execRESERVED(0);');
    }
  });
});
