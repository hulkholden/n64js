import { run, bench, group } from 'mitata';

class Helper {
  constructor() {
    this.indicesArray = [];
    for (let i = 0; i < 32; i++) {
      this.indicesArray.push(0);
    }
    this.indices32 = new Uint32Array(new ArrayBuffer(32 * 4));
    this.indices8 = new Uint8Array(new ArrayBuffer(32 * 1));
    this.fullModeSet = true;
    this.fullModeUnset = false;
  }

  lookupArray(i) { return this.indicesArray[i]; }
  lookup32(i) { return this.indices32[i]; }
  lookup8(i) { return this.indices8[i]; }
  calcFullMode(i) { return this.fullModeSet ? (i * 2) : ((i & ~1) * 2) + (i & 1); }
  calcHalfMode(i) { return this.fullModeUnset ? (i * 2) : ((i & ~1) * 2) + (i & 1); }
}
const helper = new Helper();

let sum = 0;
let reg = 0;

group('register index', () => {
  bench('lookupArray', () => {
    reg = (reg + 1) & 0x1f;
    sum += helper.lookupArray(reg);
  });
  bench('lookup32', () => {
    reg = (reg + 1) & 0x1f;
    sum += helper.lookup32(reg);
  });
  bench('lookup8', () => {
    reg = (reg + 1) & 0x1f;
    sum += helper.lookup8(reg);
  });
  bench('calcFullMode', () => {
    reg = (reg + 1) & 0x1f;
    sum += helper.calcFullMode(reg);
  });
  bench('calcHalfMode', () => {
    reg = (reg + 1) & 0x1f;
    sum += helper.calcHalfMode(reg);
  });
});

await run({});
