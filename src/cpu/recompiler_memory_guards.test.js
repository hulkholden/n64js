import { expect, test } from 'bun:test';
import * as decode from './decode.js';
import { createHeadlessEmulator } from '../headless/headless_env.js';

const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');
const pc = 0x80001000;

const integerOps = [
  ['LB', decode.OP_LB], ['LBU', decode.OP_LBU], ['LH', decode.OP_LH], ['LHU', decode.OP_LHU],
  ['LW', decode.OP_LW], ['LWU', decode.OP_LWU], ['LD', decode.OP_LD], ['LWL', decode.OP_LWL],
  ['LWR', decode.OP_LWR], ['LDL', decode.OP_LDL], ['LDR', decode.OP_LDR],
  ['SB', decode.OP_SB], ['SH', decode.OP_SH], ['SW', decode.OP_SW], ['SD', decode.OP_SD],
  ['SWL', decode.OP_SWL], ['SWR', decode.OP_SWR], ['SDL', decode.OP_SDL], ['SDR', decode.OP_SDR],
  ['LL', decode.OP_LL], ['LLD', decode.OP_LLD], ['SC', decode.OP_SC], ['SCD', decode.OP_SCD],
];

function generate(opcode, needsDelayCheck, postPC = pc + 4) {
  n64js.getSyncFlow = () => null;
  const fragment = new Fragment(pc);
  fragment.opsCompiled = 1;
  fragment.needsDelayCheck = needsDelayCheck;
  const ctx = new FragmentContext();
  ctx.set(fragment, pc, (opcode << 26) | (4 << 21) | (2 << 16), postPC, postPC);
  generateCodeForOp(ctx);
  return fragment.bodyCode;
}

for (const [name, opcode] of integerOps) {
  test(`${name} omits only the proven sequential guard`, async () => {
    await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
    const source = generate(opcode, false);
    expect(source).not.toContain('if (c.pc !==');
    expect(source).toContain('c.nextPC = 0x80001004;');
    expect(source).toContain('c.pc = c.nextPC;');
    expect(source).toContain('c.fragmentOps = 0;');
    expect(source).toContain('if (c.stuffToDo)');
    expect(generate(opcode, true)).toContain('if (c.pc !== 0x80001004)');
    expect(generate(opcode, false, pc + 8)).toContain('if (c.pc !== 0x80001008)');
  });
}

for (const [name, opcode] of [
  ['LWC1', decode.OP_LWC1], ['LDC1', decode.OP_LDC1],
  ['SWC1', decode.OP_SWC1], ['SDC1', decode.OP_SDC1],
  ['LWC2', decode.OP_LWC2], ['LDC2', decode.OP_LDC2],
  ['SWC2', decode.OP_SWC2], ['SDC2', decode.OP_SDC2],
]) {
  test(`${name} retains its guard`, async () => {
    await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
    expect(generate(opcode, false)).toContain('if (c.pc !== 0x80001004)');
  });
}
