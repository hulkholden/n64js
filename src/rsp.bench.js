import { run, bench, group } from 'mitata';
import { MemoryRegion } from './memory_region';

const vAccMem = new ArrayBuffer(8 * 8); // Actually 48 bits, not 64. 
const vAcc = new BigInt64Array(vAccMem);
const vAccS32 = new Int32Array(vAccMem);
const vAccU32 = new Uint32Array(vAccMem);
const vAccS16 = new Int16Array(vAccMem);
const vAccU16 = new Uint16Array(vAccMem);

class PCAsMember {
  constructor() {
    this.pc = 0;
  }
}
const pcAsMember = new PCAsMember();

class PCAsDataView {
  constructor() {
    const ab = new ArrayBuffer(4);
    this.dv = new DataView(ab);
  }

  get pc() { return this.dv.getInt32(0, false); }
  set pc(value) { this.dv.setUint32(0, value, false); }
}
const pcAsDataView = new PCAsDataView();

group('updatePC', () => {
  bench('usingMember', () => {
    const nextPC = pcAsMember.pc + 4;
    pcAsMember.pc = nextPC;
  });
  bench('usingDataView', () => {
    const nextPC = pcAsDataView.pc + 4;
    pcAsDataView.pc = nextPC;
  });
});

group('updateAccU32', () => {
  bench('updateAccU32Orig', () => {
    updateAccU32Orig(0, 0x0001_0000);
  });
  bench('updateAccU32New', () => {
    updateAccU32New(0, 0x0001_0000);
  });
});

group('updateAcc32SignedShift16', () => {
  bench('updateAcc32SignedShift16Orig', () => {
    updateAcc32SignedShift16Orig(0, 0x0001_0000);
  });
  bench('updateAcc32SignedShift16New', () => {
    updateAcc32SignedShift16New(0, 0x0001_0000);
  });
});

function setAccS48(el, v) { vAcc[el] = BigInt.asIntN(48, v); }

function updateAccU32Orig(el, v) {
  setAccS48(el, vAcc[el] + BigInt(v));
}

function updateAccU32New(el, v) {
  const x0 = vAccU32[(el * 2) + 0];
  const x1 = vAccS32[(el * 2) + 1];
  const y0 = v;

  const z0 = x0 + y0;
  const c = ((x0 & y0) | ((x0 | y0) & ~z0)) >>> 31;
  const z1 = x1 + c;

  vAccS32[(el * 2) + 1] = (z1 << 16) >> 16;  // truncate to s48 / sign extend
  vAccU32[(el * 2) + 0] = z0;
}

function updateAcc32SignedShift16Orig(el, v) {
  setAccS48(el, vAcc[el] + (BigInt(v) << 16n));
}

function updateAcc32SignedShift16New(el, v) {
  const x0 = vAccU32[(el * 2) + 0];
  const x1 = vAccS32[(el * 2) + 1];
  const y0 = v << 16;
  const y1 = v >> 16;

  const z0 = x0 + y0;
  const c = ((x0 & y0) | ((x0 | y0) & ~z0)) >>> 31;
  const z1 = x1 + y1 + c;

  vAccS32[(el * 2) + 1] = (z1 << 16) >> 16;  // truncate to s48 / sign extend
  vAccU32[(el * 2) + 0] = z0;
}

await run({});
