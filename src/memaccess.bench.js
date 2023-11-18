import { run, bench, group } from 'mitata';

const ab = new ArrayBuffer(8);
const s8 = new Int8Array(ab);
const s16 = new Int16Array(ab);
const s32 = new Int32Array(ab);
const u8 = new Uint8Array(ab);
const u16 = new Uint16Array(ab);
const u32 = new Uint32Array(ab);

let sum;

group('u32', () => {
  bench('signed to unsigned shift', () => {
    sum += s32[0] >>> 0;
  });
  bench('unsigned to signed shift', () => {
    sum += u32[0] >> 0;
  });
  bench('unsigned to signed or zero', () => {
    sum += u32[0] | 0;
  });
});

group('u16', () => {
  bench('signed to unsigned mask', () => {
    sum += s16[0] & 0xffff;
  });
  bench('unsigned to signed shift', () => {
    sum += (u16[0] << 16) >> 16;
  });
});

group('u8', () => {
  bench('signed to unsigned mask', () => {
    sum += s8[0] & 0xff;
  });
  bench('unsigned to signed shift', () => {
    sum += (u8[0] << 24) >> 25;
  });
});

await run({});
