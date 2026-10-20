import * as decode from './decode.js';
import {
  FACT_NONE,
  FACT_SIGN32,
  FACT_ZERO32,
  FACT_BOOL32,
  FACT_UNKNOWN64,
  FACT_AND,
  FACT_OR_XOR,
  FACT_ADDIU,
  FACT_ANDI,
  FACT_ORI_XORI,
  FACT_LUI,
  getOpTraits,
  resolveDestGpr,
} from './instruction_classifier.js';

const unknown64 = Object.freeze({ kind: 'unknown64' });
const signExtended32 = Object.freeze({ kind: 'signExtended32' });
const zeroExtended32 = Object.freeze({ kind: 'zeroExtended32' });
const boolean32 = Object.freeze({ kind: 'zeroExtended32', boolean: true });
const zero64 = Object.freeze(constant64(0n));

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
    this.regs[0] = zero64;
  }

  get(reg) { return this.regs[reg]; }

  set(reg, fact) {
    if (reg !== 0) {
      this.regs[reg] = fact;
    }
  }

  update(instruction) {
    const traits = getOpTraits(instruction);
    const dest = resolveDestGpr(instruction, traits.destField);
    switch (traits.gprFactRule) {
      // Nonlink branches, jumps, integer stores, HI/LO writes and multiply/divide
      // preserve all GPRs.
      case FACT_NONE:
        return;
      // Word shifts (including the existing full-source SRA/SRAV helpers),
      // nontrapping word arithmetic, JAL/JALR link writes and signed word/subword
      // loads always sign extend their result.
      case FACT_SIGN32:
        return this.set(dest, signExtended32);
      case FACT_ZERO32:
        return this.set(dest, zeroExtended32);
      case FACT_BOOL32:
        return this.set(dest, boolean32);
      // Full-width writes, including partial and shift results, kill dest.
      case FACT_UNKNOWN64:
        return this.set(dest, unknown64);
      case FACT_AND: { // One zero-extended input clears the upper word.
        const s = this.get(decode.rs(instruction));
        const t = this.get(decode.rt(instruction));
        return this.set(dest, isUnsigned32(s) || isUnsigned32(t) ? zeroExtended32 :
          isSigned32(s) && isSigned32(t) ? signExtended32 : unknown64);
      }
      case FACT_OR_XOR: {
        const s = this.get(decode.rs(instruction));
        const t = this.get(decode.rt(instruction));
        return this.set(dest, isSigned32(s) && isSigned32(t) ? signExtended32 :
          isUnsigned32(s) && isUnsigned32(t) ? zeroExtended32 : unknown64);
      }
      case FACT_ADDIU: { // Wraps at 32 bits even for a full-width input.
        const s = this.get(decode.rs(instruction));
        return this.set(dest, s.kind === 'constant64' ?
          constant64(BigInt.asIntN(32, s.value + BigInt(decode.imms(instruction)))) : signExtended32);
      }
      case FACT_ANDI: { // Always clears bits 16..63.
        const s = this.get(decode.rs(instruction));
        return this.set(dest, s.kind === 'constant64' ?
          constant64(s.value & BigInt(decode.imm(instruction))) : zeroExtended32);
      }
      case FACT_ORI_XORI: { // Leave bits 16..63 unchanged.
        const s = this.get(decode.rs(instruction));
        const imm = BigInt(decode.imm(instruction));
        if (s.kind === 'constant64') {
          return this.set(dest, constant64(decode.simpleOp(instruction) === decode.OP_ORI ? (s.value | imm) : (s.value ^ imm)));
        }
        return this.set(dest, isSigned32(s) ? signExtended32 : isUnsigned32(s) ? zeroExtended32 : unknown64);
      }
      case FACT_LUI:
        return this.set(dest, constant64(BigInt(decode.imm(instruction) << 16)));
      // Includes trapping arithmetic, coprocessors, CACHE, reserved instructions
      // and other generic effects. No proof crosses these barriers yet.
      default:
        return this.reset();
    }
  }
}
