import { clamp16, mulFraction, clampFixed16Hi } from './audio_fixed_point.js';
import { performanceProfile } from '../debug/performance_profile.js';
import { RSP } from '../rsp/rsp.js';

const CODE_START = 0x80;
const CODE_BYTES = 3520;
const RESAMPLE = 0x9d8;
const ENVELOPE = 0xcd0;

// GoldenEye's resampler and envelope loops operate entirely on local SP
// memory. Execute one bounded iteration at its original final instruction
// time. The loader, command dispatch, all RAM DMAs, waits and BREAK still run
// on the RSP. In particular, an idle PI never permits an early sample read.
//
// No work is committed while an iteration is pending. A bus access to SP
// memory, halt or debugger observation materializes only its elapsed LLE
// instructions. Unsupported code continues at the current PC, with no task
// rollback and no replay of committed RAM writes. Reset simply drops the
// pending iteration. There are no new CPU event deadlines (#174).
export class GoldenEyeAudioStream {
  constructor(rsp, code) {
    this.rsp = rsp;
    this.code = code.slice(0, CODE_BYTES);
    this.products = new Int16Array(8);
    this.sums = new Int16Array(8);
    this.programs = new Map();
    this.generation = -1;
    this.remaining = 0;
    this.elapsed = 0;
  }

  step() {
    if (this.remaining) {
      this.elapsed++;
      if (--this.remaining === 0) {
        this.execute();
      }
      return true;
    }
    const r = this.rsp;
    if ((r.pc !== RESAMPLE && r.pc !== ENVELOPE) || r.delayPC || r.VCO) {
      return false;
    }
    const sp = r.hardware.spRegDevice;
    if (sp.dmaQueue.length) {
      return false;
    }
    if (this.generation !== sp.imemGeneration) {
      // The actual loader can see code changed after task classification.
      const imem = r.imem.u8;
      for (let i = 0; i < CODE_BYTES; i++) {
        if (imem[CODE_START + i] !== this.code[i]) {
          r.setAudioHLE(null);
          return false;
        }
      }
      this.generation = sp.imemGeneration;
    }
    this.entry = r.pc;
    const count = r.getRegS32(this.entry === RESAMPLE ? 18 : 14);
    if (count < 16 || count > 4096 || count % 16) {
      return false;
    }
    this.cycles = this.entry === RESAMPLE ? (count === 16 ? 62 : 64)
      : 39 + (r.getRegS32(21) <= 0 ? 2 : 0) + (r.getRegS32(20) <= 0 ? 2 : 0) - (count === 16 ? 2 : 0);
    this.elapsed = 1;
    this.remaining = this.cycles - 1;
    return true;
  }

  synchronize() {
    const elapsed = this.elapsed;
    if (!this.remaining) {
      return;
    }
    this.remaining = 0;
    this.elapsed = 0;
    for (let i = 0; i < elapsed; i++) {
      this.interpret();
    }
  }

  interpret() {
    if (performanceProfile.enabled) {
      this.rsp.stepProfiled();
    } else {
      RSP.prototype.step.call(this.rsp);
    }
  }

  // These are the two reviewed loop bodies, not a general RSP compiler. Keep
  // address/phase operations in order, elide their known local branches, and
  // fuse only DSP operations whose intermediate accumulator is dead.
  program() {
    const r = this.rsp, last = r.getRegS32(this.entry === RESAMPLE ? 18 : 14) === 16;
    const left = r.getRegS32(21) > 0, right = r.getRegS32(20) > 0;
    const key = this.entry * 8 + (last ? 4 : 0) + (left ? 2 : 0) + (right ? 1 : 0);
    let program = this.programs.get(key);
    if (program) {
      return program;
    }
    const words = [], code = new DataView(this.code.buffer);
    let interpreted = 0;
    const add = pc => {
      if (this.entry === RESAMPLE && (
        pc === 0xa38 || pc === 0xa40 || pc === 0xa48 || pc === 0xa54 ||
        pc === 0xa5c || pc === 0xa64 || pc === 0xa6c || pc === 0xa74 ||
        pc === 0xa7c || pc === 0xa84 || pc === 0xa8c || pc === 0xa94)) {
        if (pc === 0xa94) {
          words.push(-1);
        }
      } else if (this.entry === ENVELOPE && (pc === 0xd18 || pc === 0xd24 || pc === 0xd70 || pc === 0xd80)) {
        // VMULF's accumulator is consumed only by the paired VMACF below.
      } else if (this.entry === ENVELOPE && (pc === 0xd1c || pc === 0xd2c || pc === 0xd78 || pc === 0xd84)) {
        words.push(pc === 0xd1c ? -2 : pc === 0xd2c ? -3 : pc === 0xd78 ? -4 : -5);
      } else {
        const word = code.getUint32(pc - CODE_START);
        if (word) {
          words.push(word); interpreted++;
        }
      }
    };
    const range = (start, end) => {
      for (let pc = start; pc < end; pc += 4) {
        add(pc);
      }
    };
    if (this.entry === RESAMPLE) {
      range(RESAMPLE, 0xac8);
      add(0xacc);
      if (!last) {
        add(0xad4);
      }
    } else {
      add(0xcd4);
      range(left ? 0xcf4 : 0xcd8, left ? 0xd08 : 0xcec);
      range(0xd08, 0xd30);
      add(0xd34);
      range(right ? 0xd50 : 0xd38, right ? 0xd60 : 0xd48);
      range(0xd60, 0xd90);
      add(0xd94);
      if (!last) {
        add(0xd9c);
      }
    }
    program = { words, interpreted, next: last ? (this.entry === RESAMPLE ? 0xad8 : 0xda0) : this.entry };
    this.programs.set(key, program);
    return program;
  }

  execute() {
    const r = this.rsp, program = this.program();
    this.elapsed = 0;
    if (performanceProfile.enabled) {
      performanceProfile.counters.rspAudioHLEBlocks++;
      performanceProfile.counters.rspAudioHLECycles += this.cycles;
      performanceProfile.counters.rspInstructions += program.interpreted;
    }
    for (const word of program.words) {
      switch (word) {
        case -1: this.resampleTaps(); break;
        case -2: this.mix(29, 16); break;
        case -3: this.mix(27, 15); break;
        case -4: this.mix(28, 16); break;
        case -5: this.mix(26, 15); break;
        default: r.executeOp(word); break;
      }
    }
    r.pc = program.next;
    r.nextPC = program.next;
    r.delayPC = 0;
    r.branchTarget = 0;
  }

  resampleTaps() {
    const r = this.rsp, products = this.products, sums = this.sums;
    for (let v = 0; v < 4; v++) {
      for (let lane = 0; lane < 8; lane++) {
        products[lane] = mulFraction(r.getVecS16(16 - v * 2, lane), r.getVecS16(15 - v * 2, lane));
      }
      for (let lane = 0, select = r.vecSelectU32[3]; lane < 8; lane++, select >>>= 4) {
        sums[lane] = clamp16(products[lane] + products[select & 7]);
      }
      for (let lane = 0, select = r.vecSelectU32[6]; lane < 8; lane++, select >>>= 4) {
        r.setVecS16(8 - v, lane, clamp16(sums[lane] + sums[select & 7]));
      }
    }
    r.VCO = 0;
  }

  mix(destination, gain) {
    const r = this.rsp, scale = r.getVecS16(10, 6);
    for (let lane = 0; lane < 8; lane++) {
      const accumulator = r.getVecS16(destination, lane) * scale * 2 + 0x8000
        + r.getVecS16(17, lane) * r.getVecS16(gain, lane) * 2;
      r.updateAccHiLo(lane, Math.floor(accumulator / 0x100000000), accumulator | 0, false);
      r.setVecS16(destination, lane, clampFixed16Hi(accumulator));
    }
  }
}
