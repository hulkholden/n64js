import { simpleOp, specialOp, rs, rt, rd, imm, imms } from './decode.js';

const unknown64 = Object.freeze({ kind: 'unknown64' });
const signExtended32 = Object.freeze({ kind: 'signExtended32' });
const zeroExtended32 = Object.freeze({ kind: 'zeroExtended32' });
const boolean32 = Object.freeze({ kind: 'zeroExtended32', boolean: true });

export function constant64(value) {
  return { kind: 'constant64', value: BigInt.asIntN(64, value) };
}

export function isSigned32(fact) {
  return fact.kind === 'signExtended32' || fact.boolean === true ||
    (fact.kind === 'constant64' && fact.value === BigInt.asIntN(32, fact.value));
}

export function isUnsigned32(fact) {
  return fact.kind === 'zeroExtended32' ||
    (fact.kind === 'constant64' && fact.value >= 0n && fact.value <= 0xffffffffn);
}

export function isKnown32(fact) {
  return isSigned32(fact) || isUnsigned32(fact);
}

// Facts describe instruction semantics on the continuing trace, never training
// values. Unlisted effects discard all proofs, so new instructions fail closed.
export class GPRFacts {
  constructor() {
    this.regs = new Array(32);
    this.reset();
  }

  reset() {
    this.regs.fill(unknown64);
    this.regs[0] = constant64(0n);
  }

  get(reg) { return this.regs[reg]; }

  set(reg, fact) {
    if (reg !== 0) this.regs[reg] = fact;
  }

  update(instruction) {
    const s = this.get(rs(instruction));
    const t = this.get(rt(instruction));
    const writeRT = fact => this.set(rt(instruction), fact);
    const writeRD = fact => this.set(rd(instruction), fact);
    switch (simpleOp(instruction)) {
      case 0x00:
        switch (specialOp(instruction)) {
          // Word shifts (including the existing full-source SRA/SRAV helpers)
          // and nontrapping word arithmetic always sign extend their result.
          case 0x00: case 0x02: case 0x03: case 0x04: case 0x06: case 0x07:
          case 0x21: case 0x23:
            return writeRD(signExtended32);
          case 0x2a: case 0x2b:
            return writeRD(boolean32);
          case 0x24: // AND: one zero-extended input clears the upper word.
            return writeRD(isUnsigned32(s) || isUnsigned32(t) ? zeroExtended32 :
              isSigned32(s) && isSigned32(t) ? signExtended32 : unknown64);
          case 0x25: case 0x26: // OR / XOR
            return writeRD(isSigned32(s) && isSigned32(t) ? signExtended32 :
              isUnsigned32(s) && isUnsigned32(t) ? zeroExtended32 : unknown64);
          case 0x09: // JALR
            return writeRD(signExtended32);
          // Full-width writes, including partial and shift results, kill rd.
          case 0x10: case 0x12: case 0x14: case 0x16: case 0x17: case 0x27:
          case 0x2d: case 0x2f: case 0x38: case 0x3a: case 0x3b:
          case 0x3c: case 0x3e: case 0x3f:
            return writeRD(unknown64);
          // JR, HI/LO writes, multiply/divide do not write GPRs.
          case 0x08: case 0x11: case 0x13:
          case 0x18: case 0x19: case 0x1a: case 0x1b:
          case 0x1c: case 0x1d: case 0x1e: case 0x1f:
            return;
          default: return this.reset();
        }
      case 0x03: // JAL
        return this.set(31, signExtended32);
      case 0x09: // ADDIU wraps at 32 bits even for a full-width input.
        return writeRT(s.kind === 'constant64' ?
          constant64(BigInt.asIntN(32, s.value + BigInt(imms(instruction)))) : signExtended32);
      case 0x0a: case 0x0b:
        return writeRT(boolean32);
      case 0x0c: // ANDI always clears bits 16..63.
        return writeRT(s.kind === 'constant64' ? constant64(s.value & BigInt(imm(instruction))) : zeroExtended32);
      case 0x0d: case 0x0e: // ORI / XORI leave bits 16..63 unchanged.
        return writeRT(isSigned32(s) ? signExtended32 : isUnsigned32(s) ? zeroExtended32 : unknown64);
      case 0x0f:
        return writeRT(constant64(BigInt(imm(instruction) << 16)));
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x26: case 0x30:
        return writeRT(signExtended32); // LB, LH, LWL, LW, LWR, LL
      case 0x24: case 0x25: case 0x27:
        return writeRT(zeroExtended32); // LBU, LHU, LWU
      case 0x38: case 0x3c:
        return writeRT(boolean32); // SC / SCD
      case 0x19: case 0x1a: case 0x1b: case 0x34: case 0x37:
        return writeRT(unknown64); // DADDIU, LDL, LDR, LLD, LD
      // Nonlink branches, jumps and integer stores preserve all GPRs.
      case 0x02: case 0x04: case 0x05: case 0x06: case 0x07:
      case 0x14: case 0x15: case 0x16: case 0x17:
      case 0x28: case 0x29: case 0x2a: case 0x2b: case 0x2c: case 0x2d: case 0x2e: case 0x3f:
        return;
      // Includes trapping arithmetic, coprocessors, CACHE, reserved instructions
      // and other generic effects. No proof crosses these barriers yet.
      default: return this.reset();
    }
  }
}
