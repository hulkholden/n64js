import * as decode from './decode.js';

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
    const s = this.get(decode.rs(instruction));
    const t = this.get(decode.rt(instruction));
    const writeRT = fact => this.set(decode.rt(instruction), fact);
    const writeRD = fact => this.set(decode.rd(instruction), fact);
    switch (decode.simpleOp(instruction)) {
      case decode.OP_SPECIAL:
        switch (decode.specialOp(instruction)) {
          // Word shifts (including the existing full-source SRA/SRAV helpers)
          // and nontrapping word arithmetic always sign extend their result.
          case decode.SPECIAL_SLL: case decode.SPECIAL_SRL: case decode.SPECIAL_SRA:
          case decode.SPECIAL_SLLV: case decode.SPECIAL_SRLV: case decode.SPECIAL_SRAV:
          case decode.SPECIAL_ADDU: case decode.SPECIAL_SUBU:
            return writeRD(signExtended32);
          case decode.SPECIAL_SLT: case decode.SPECIAL_SLTU:
            return writeRD(boolean32);
          case decode.SPECIAL_AND: // One zero-extended input clears the upper word.
            return writeRD(isUnsigned32(s) || isUnsigned32(t) ? zeroExtended32 :
              isSigned32(s) && isSigned32(t) ? signExtended32 : unknown64);
          case decode.SPECIAL_OR: case decode.SPECIAL_XOR:
            return writeRD(isSigned32(s) && isSigned32(t) ? signExtended32 :
              isUnsigned32(s) && isUnsigned32(t) ? zeroExtended32 : unknown64);
          case decode.SPECIAL_JALR:
            return writeRD(signExtended32);
          // Full-width writes, including partial and shift results, kill rd.
          case decode.SPECIAL_MFHI: case decode.SPECIAL_MFLO:
          case decode.SPECIAL_DSLLV: case decode.SPECIAL_DSRLV: case decode.SPECIAL_DSRAV:
          case decode.SPECIAL_NOR:
          case decode.SPECIAL_DADDU: case decode.SPECIAL_DSUBU:
          case decode.SPECIAL_DSLL: case decode.SPECIAL_DSRL: case decode.SPECIAL_DSRA:
          case decode.SPECIAL_DSLL32: case decode.SPECIAL_DSRL32: case decode.SPECIAL_DSRA32:
            return writeRD(unknown64);
          // JR, HI/LO writes, multiply/divide do not write GPRs.
          case decode.SPECIAL_JR: case decode.SPECIAL_MTHI: case decode.SPECIAL_MTLO:
          case decode.SPECIAL_MULT: case decode.SPECIAL_MULTU: case decode.SPECIAL_DIV: case decode.SPECIAL_DIVU:
          case decode.SPECIAL_DMULT: case decode.SPECIAL_DMULTU: case decode.SPECIAL_DDIV: case decode.SPECIAL_DDIVU:
            return;
          default: return this.reset();
        }
      case decode.OP_JAL:
        return this.set(31, signExtended32);
      case decode.OP_ADDIU: // Wraps at 32 bits even for a full-width input.
        return writeRT(s.kind === 'constant64' ?
          constant64(BigInt.asIntN(32, s.value + BigInt(decode.imms(instruction)))) : signExtended32);
      case decode.OP_SLTI: case decode.OP_SLTIU:
        return writeRT(boolean32);
      case decode.OP_ANDI: // Always clears bits 16..63.
        return writeRT(s.kind === 'constant64' ? constant64(s.value & BigInt(decode.imm(instruction))) : zeroExtended32);
      case decode.OP_ORI: case decode.OP_XORI: // Leave bits 16..63 unchanged.
        return writeRT(isSigned32(s) ? signExtended32 : isUnsigned32(s) ? zeroExtended32 : unknown64);
      case decode.OP_LUI:
        return writeRT(constant64(BigInt(decode.imm(instruction) << 16)));
      case decode.OP_LB: case decode.OP_LH: case decode.OP_LWL: case decode.OP_LW: case decode.OP_LWR: case decode.OP_LL:
        return writeRT(signExtended32);
      case decode.OP_LBU: case decode.OP_LHU: case decode.OP_LWU:
        return writeRT(zeroExtended32);
      case decode.OP_SC: case decode.OP_SCD:
        return writeRT(boolean32);
      case decode.OP_DADDIU: case decode.OP_LDL: case decode.OP_LDR: case decode.OP_LLD: case decode.OP_LD:
        return writeRT(unknown64);
      // Nonlink branches, jumps and integer stores preserve all GPRs.
      case decode.OP_J: case decode.OP_BEQ: case decode.OP_BNE: case decode.OP_BLEZ: case decode.OP_BGTZ:
      case decode.OP_BEQL: case decode.OP_BNEL: case decode.OP_BLEZL: case decode.OP_BGTZL:
      case decode.OP_SB: case decode.OP_SH: case decode.OP_SWL: case decode.OP_SW: case decode.OP_SDL: case decode.OP_SDR: case decode.OP_SWR: case decode.OP_SD:
        return;
      // Includes trapping arithmetic, coprocessors, CACHE, reserved instructions
      // and other generic effects. No proof crosses these barriers yet.
      default: return this.reset();
    }
  }
}
