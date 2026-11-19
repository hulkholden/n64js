import { describe, expect, test } from 'bun:test';
import { CPU1 } from './cpu1.js';

const FPCSR_RM_RP = 0x00000002;
const FPCSR_RM_RM = 0x00000003;
const FPCSR_FI = 0x00000004;
const FPCSR_FO = 0x00000010;
const FPCSR_EO = 0x00000200;
const FPCSR_CI = 0x00001000;
const FPCSR_CO = 0x00004000;

function createFPU() {
  let faults = 0;
  const fpu = new CPU1({ cpu0: { raiseFPE() { faults++; } } });
  return { fpu, faults: () => faults };
}

describe('CPU1.CVT_S_D post-rounding overflow', () => {
  const sentinel = 0x123456789abcdef0n;
  const cases = [
    {
      label: 'negative value rounded toward -infinity',
      value: -3.4028235e+38,
      rm: FPCSR_RM_RM,
      expectedBits: 0xff800000,
    },
    {
      label: 'positive value rounded toward +infinity',
      value: 3.4028235e+38,
      rm: FPCSR_RM_RP,
      expectedBits: 0x7f800000,
    },
  ];

  for (const { label, value, rm, expectedBits } of cases) {
    test(`sets overflow and inexact flags when ${label} overflows`, () => {
      const { fpu, faults } = createFPU();
      fpu.regF64[fpu.fsRegIdx64(0)] = value;
      fpu.regU64[fpu.fdRegIdx64(2)] = sentinel;
      fpu.control[31] = rm;

      fpu.CVT_S_D(2, 0);

      expect(fpu.regU32[fpu.fdRegIdx32(2)]).toBe(expectedBits);
      expect(fpu.control[31]).toBe(rm | FPCSR_CO | FPCSR_CI | FPCSR_FO | FPCSR_FI);
      expect(faults()).toBe(0);
    });

    test(`traps and preserves destination when ${label} overflows with EO enabled`, () => {
      const { fpu, faults } = createFPU();
      fpu.regF64[fpu.fsRegIdx64(0)] = value;
      fpu.regU64[fpu.fdRegIdx64(2)] = sentinel;
      fpu.control[31] = rm | FPCSR_EO;

      fpu.CVT_S_D(2, 0);

      expect(faults()).toBe(1);
      expect(fpu.regU64[fpu.fdRegIdx64(2)]).toBe(sentinel);
      expect(fpu.control[31]).toBe(rm | FPCSR_EO | FPCSR_CO | FPCSR_CI);
    });
  }
});
