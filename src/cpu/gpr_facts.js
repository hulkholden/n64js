import {
  simpleOp, specialOp, rs, rt, rd, imm, imms,
  OP_SPECIAL, OP_J, OP_JAL, OP_BEQ, OP_BNE, OP_BLEZ, OP_BGTZ, OP_ADDIU, OP_SLTI, OP_SLTIU, OP_ANDI, OP_ORI,
  OP_XORI, OP_LUI, OP_BEQL, OP_BNEL, OP_BLEZL, OP_BGTZL, OP_DADDIU, OP_LDL, OP_LDR, OP_LB, OP_LH, OP_LWL,
  OP_LW, OP_LBU, OP_LHU, OP_LWR, OP_LWU, OP_SB, OP_SH, OP_SWL, OP_SW, OP_SDL, OP_SDR, OP_SWR, OP_LL, OP_LLD,
  OP_LD, OP_SC, OP_SCD, OP_SD,
  SPECIAL_SLL, SPECIAL_SRL, SPECIAL_SRA, SPECIAL_SLLV, SPECIAL_SRLV, SPECIAL_SRAV, SPECIAL_JR, SPECIAL_JALR,
  SPECIAL_MFHI, SPECIAL_MTHI, SPECIAL_MFLO, SPECIAL_MTLO, SPECIAL_DSLLV, SPECIAL_DSRLV, SPECIAL_DSRAV,
  SPECIAL_MULT, SPECIAL_MULTU, SPECIAL_DIV, SPECIAL_DIVU, SPECIAL_DMULT, SPECIAL_DMULTU, SPECIAL_DDIV,
  SPECIAL_DDIVU, SPECIAL_ADDU, SPECIAL_SUBU, SPECIAL_AND, SPECIAL_OR, SPECIAL_XOR, SPECIAL_NOR, SPECIAL_SLT,
  SPECIAL_SLTU, SPECIAL_DADDU, SPECIAL_DSUBU, SPECIAL_DSLL, SPECIAL_DSRL, SPECIAL_DSRA, SPECIAL_DSLL32,
  SPECIAL_DSRL32, SPECIAL_DSRA32,
} from './decode.js';

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
    if (reg !== 0) this.regs[reg] = fact;
  }

  update(instruction) {
    const s = this.get(rs(instruction));
    const t = this.get(rt(instruction));
    const writeRT = fact => this.set(rt(instruction), fact);
    const writeRD = fact => this.set(rd(instruction), fact);
    switch (simpleOp(instruction)) {
      case OP_SPECIAL:
        switch (specialOp(instruction)) {
          // Word shifts (including the existing full-source SRA/SRAV helpers)
          // and nontrapping word arithmetic always sign extend their result.
          case SPECIAL_SLL: case SPECIAL_SRL: case SPECIAL_SRA:
          case SPECIAL_SLLV: case SPECIAL_SRLV: case SPECIAL_SRAV:
          case SPECIAL_ADDU: case SPECIAL_SUBU:
            return writeRD(signExtended32);
          case SPECIAL_SLT: case SPECIAL_SLTU:
            return writeRD(boolean32);
          case SPECIAL_AND: // One zero-extended input clears the upper word.
            return writeRD(isUnsigned32(s) || isUnsigned32(t) ? zeroExtended32 :
              isSigned32(s) && isSigned32(t) ? signExtended32 : unknown64);
          case SPECIAL_OR: case SPECIAL_XOR:
            return writeRD(isSigned32(s) && isSigned32(t) ? signExtended32 :
              isUnsigned32(s) && isUnsigned32(t) ? zeroExtended32 : unknown64);
          case SPECIAL_JALR:
            return writeRD(signExtended32);
          // Full-width writes, including partial and shift results, kill rd.
          case SPECIAL_MFHI: case SPECIAL_MFLO:
          case SPECIAL_DSLLV: case SPECIAL_DSRLV: case SPECIAL_DSRAV:
          case SPECIAL_NOR:
          case SPECIAL_DADDU: case SPECIAL_DSUBU:
          case SPECIAL_DSLL: case SPECIAL_DSRL: case SPECIAL_DSRA:
          case SPECIAL_DSLL32: case SPECIAL_DSRL32: case SPECIAL_DSRA32:
            return writeRD(unknown64);
          // JR, HI/LO writes, multiply/divide do not write GPRs.
          case SPECIAL_JR: case SPECIAL_MTHI: case SPECIAL_MTLO:
          case SPECIAL_MULT: case SPECIAL_MULTU: case SPECIAL_DIV: case SPECIAL_DIVU:
          case SPECIAL_DMULT: case SPECIAL_DMULTU: case SPECIAL_DDIV: case SPECIAL_DDIVU:
            return;
          default: return this.reset();
        }
      case OP_JAL:
        return this.set(31, signExtended32);
      case OP_ADDIU: // Wraps at 32 bits even for a full-width input.
        return writeRT(s.kind === 'constant64' ?
          constant64(BigInt.asIntN(32, s.value + BigInt(imms(instruction)))) : signExtended32);
      case OP_SLTI: case OP_SLTIU:
        return writeRT(boolean32);
      case OP_ANDI: // Always clears bits 16..63.
        return writeRT(s.kind === 'constant64' ? constant64(s.value & BigInt(imm(instruction))) : zeroExtended32);
      case OP_ORI: case OP_XORI: // Leave bits 16..63 unchanged.
        return writeRT(isSigned32(s) ? signExtended32 : isUnsigned32(s) ? zeroExtended32 : unknown64);
      case OP_LUI:
        return writeRT(constant64(BigInt(imm(instruction) << 16)));
      case OP_LB: case OP_LH: case OP_LWL: case OP_LW: case OP_LWR: case OP_LL:
        return writeRT(signExtended32);
      case OP_LBU: case OP_LHU: case OP_LWU:
        return writeRT(zeroExtended32);
      case OP_SC: case OP_SCD:
        return writeRT(boolean32);
      case OP_DADDIU: case OP_LDL: case OP_LDR: case OP_LLD: case OP_LD:
        return writeRT(unknown64);
      // Nonlink branches, jumps and integer stores preserve all GPRs.
      case OP_J: case OP_BEQ: case OP_BNE: case OP_BLEZ: case OP_BGTZ:
      case OP_BEQL: case OP_BNEL: case OP_BLEZL: case OP_BGTZL:
      case OP_SB: case OP_SH: case OP_SWL: case OP_SW: case OP_SDL: case OP_SDR: case OP_SWR: case OP_SD:
        return;
      // Includes trapping arithmetic, coprocessors, CACHE, reserved instructions
      // and other generic effects. No proof crosses these barriers yet.
      default: return this.reset();
    }
  }
}
