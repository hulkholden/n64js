import { expect, test } from 'bun:test';
import { createHeadlessEmulator } from '../headless/headless_env.js';

const { Fragment } = await import('./fragments.js');
const { FragmentContext, generateCodeForOp } = await import('./recompiler.js');
const pc = 0x80001000;

const integerOps = [
  ['LB', 0x20], ['LBU', 0x24], ['LH', 0x21], ['LHU', 0x25],
  ['LW', 0x23], ['LWU', 0x27], ['LD', 0x37], ['LWL', 0x22],
  ['LWR', 0x26], ['LDL', 0x1a], ['LDR', 0x1b],
  ['SB', 0x28], ['SH', 0x29], ['SW', 0x2b], ['SD', 0x3f],
  ['SWL', 0x2a], ['SWR', 0x2e], ['SDL', 0x2c], ['SDR', 0x2d],
  ['LL', 0x30], ['LLD', 0x34], ['SC', 0x38], ['SCD', 0x3c],
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

for (const opcode of [0x31, 0x35, 0x39, 0x3d, 0x32, 0x36, 0x3a, 0x3e]) {
  test(`coprocessor memory opcode ${opcode.toString(16)} retains its guard`, async () => {
    await createHeadlessEmulator({ romBuffer: new ArrayBuffer(0x1000), rominfo: { cic: '6102', tvType: 1, save: 'Eeprom4k' } });
    expect(generate(opcode, false)).toContain('if (c.pc !== 0x80001004)');
  });
}
