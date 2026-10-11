import { beforeEach, describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import { MemoryRegion } from '../memory/memory_region.js';
import { initRSP, RSP } from './rsp.js';

let rsp;
beforeEach(() => {
  const hardware = { sp_mem: new MemoryRegion(new ArrayBuffer(0x2000)), sp_ibist_mem: new MemoryRegion(new ArrayBuffer(8)) };
  rsp = hardware.rsp = new RSP(hardware);
  initRSP(hardware);
});

const accEdges = [0n, 1n, -1n, 0x7fffffffn, 0x80000000n, -0x80000000n,
  -0x80000001n, 0xffffffffn, 0x100000000n, -0x100000000n, -0x100000001n,
  0x7fffffffffffn, -0x800000000000n, 0x1fffffn, 0x200000n, 0x400000n,
  -0x200000n, -0x400000n, 0xffffn, 0x10000n];
const vecEdges = [-32768, 32767, -1, 0, 1, 31, -31, 16384];
const signedMid = acc => Math.max(-32768, Math.min(32767, Number(acc >> 16n)));
const oddified = acc => Math.max(-32768, Math.min(32767, Number(acc >> 17n))) & 0xfff0;

function selectedLane(element, lane) {
  if (element < 2) {
    return lane;
  }
  if (element < 4) {
    return (lane & ~1) | (element & 1);
  }
  if (element < 8) {
    return (lane & ~3) | (element & 3);
  }
  return element & 7;
}

describe('RSP unsigned saturation, rounding and quantization', () => {
  for (const [name, funct] of [['VMULU', 0x01], ['VMACU', 0x09], ['VRNDP', 0x02], ['VRNDN', 0x0a], ['VMULQ', 0x03], ['VMACQ', 0x0b]]) {
    for (let element = 0; element < 16; element++) {
      test(`${name} element ${element} matches a signed-48 BigInt oracle`, () => {
        let seed = 0x123456789abcdefn;
        for (const [s, t, d] of [[30, 0, 15], [31, 0, 15], [31, 0, 31], [30, 0, 0], [31, 31, 31]]) {
          for (let sample = 0; sample < 96; sample++) {
            rsp.vprU32.fill(0xa5a5a5a5);
            for (let lane = 0; lane < 8; lane++) {
              seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
              rsp.setAccS48(lane, sample < 40 ? accEdges[(sample + lane) % accEdges.length] : seed);
              rsp.setVecS16(s, lane, sample < 64 ? vecEdges[(sample + lane) & 7] : Number(BigInt.asIntN(16, seed)));
              rsp.setVecS16(t, lane, sample < 64 ? vecEdges[((sample >>> 3) + lane) & 7] : Number(BigInt.asIntN(16, seed >> 32n)));
            }
            rsp.VCO = 0xa55a; rsp.VCC = 0x5aa5; rsp.VCE = 0x81;
            const expectedAcc = [...rsp.vAcc];
            const expectedVec = new DataView(rsp.vpr.buffer.slice(0));
            for (let lane = 0; lane < 8; lane++) {
              let acc = expectedAcc[lane];
              const lhs = BigInt(rsp.getVecS16(s, lane));
              const rhs = BigInt(rsp.getVecS16(t, selectedLane(element, lane)));
              let result;
              if (name === 'VMULU' || name === 'VMACU') {
                acc = BigInt.asIntN(48, lhs * rhs * 2n + (name === 'VMULU' ? 0x8000n : acc));
                result = acc < 0n ? 0 : acc > 0x7fffffffn ? 0xffff : Number(acc >> 16n);
              } else if (name === 'VRNDP' || name === 'VRNDN') {
                if (name === 'VRNDP' ? acc >= 0n : acc < 0n) {
                  acc = BigInt.asIntN(48, acc + (rhs << ((s & 1) ? 16n : 0n)));
                }
                result = signedMid(acc);
              } else if (name === 'VMULQ') {
                const product = lhs * rhs;
                acc = BigInt.asIntN(48, (product + (product < 0n ? 31n : 0n)) << 16n);
                result = oddified(acc);
              } else {
                if ((acc & 0x200000n) === 0n) {
                  const upper = acc >> 22n;
                  acc = BigInt.asIntN(48, acc + (upper < 0n ? 0x200000n : upper > 0n ? -0x200000n : 0n));
                }
                result = oddified(acc);
              }
              expectedAcc[lane] = acc;
              expectedVec.setUint16(d * 16 + lane * 2, result);
            }
            rsp.executeOp(0x4a000000 | (element << 21) | (t << 16) | (s << 11) | (d << 6) | funct);
            expect([...rsp.vAcc]).toEqual(expectedAcc);
            expect([...rsp.vprU32]).toEqual([...new Uint32Array(expectedVec.buffer)]);
            expect([rsp.VCO, rsp.VCC, rsp.VCE]).toEqual([0xa55a, 0x5aa5, 0x81]);
          }
        }
      });
    }
  }
});
