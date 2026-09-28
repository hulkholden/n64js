// Audio microcode observations, not HLE handler selection. See
// docs/audio-microcode-detection.md for the derivation and limits of these rules.

import {
  simpleOp, specialOp, copOp, rs, rt, rd, sa, imm, imms, branchAddress, jumpAddress,
  OP_SPECIAL, OP_REGIMM, OP_J, OP_JAL, OP_BEQ, OP_BNE, OP_BLEZ, OP_BGTZ,
  OP_ADDI, OP_ADDIU, OP_ANDI, OP_ORI, OP_COP0, OP_LB, OP_LH, OP_LW, OP_LBU, OP_LHU, OP_SH,
  SPECIAL_SLL, SPECIAL_SRL, SPECIAL_JR, SPECIAL_JALR, SPECIAL_BREAK, SPECIAL_ADD, SPECIAL_ADDU, SPECIAL_OR,
  COP0_MTC0, COP0_REG_SP_MEM_ADDR, COP0_REG_SP_DRAM_ADDR, COP0_REG_SP_RD_LEN, GPR_ZERO, INSTR_NOP,
} from '../rsp/decode_rsp.js';

const shift = (i, kind, amount) => simpleOp(i) === OP_SPECIAL && specialOp(i) === kind && sa(i) === amount;
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Establish the familiar boot loader from its DMA setup, rather than from an
// OSTask ucode_size that several games leave zero or set incorrectly.
function hasStandardLoader(boot) {
  const data = view(boot);
  for (let p = 0; p + 24 <= Math.min(boot.length, 0x100); p += 4) {
    const words = Array.from({ length: 6 }, (_, n) => data.getUint32(p + n * 4));
    const [source, length, destination, mem, dram, read] = words;
    if (simpleOp(source) !== OP_LW || imm(source) !== 0x10 ||
        simpleOp(length) !== OP_ADDI || rs(length) !== GPR_ZERO || imm(length) !== 0xf7f ||
        simpleOp(destination) !== OP_ADDI || rs(destination) !== GPR_ZERO || imm(destination) !== 0x1080) continue;
    const mtc0 = (i, from, to) => simpleOp(i) === OP_COP0 && copOp(i) === COP0_MTC0 && rt(i) === from && rd(i) === to;
    if (mtc0(mem, rt(destination), COP0_REG_SP_MEM_ADDR) &&
        mtc0(dram, rt(source), COP0_REG_SP_DRAM_ADDR) && mtc0(read, rt(length), COP0_REG_SP_RD_LEN)) return true;
  }
  return false;
}

/** Copy bounded task images for a synchronous task-start observer. No command
 * list or sample data is read. Addresses use the same physical mapping as RSPTask.
 * A snapshot is independent of later guest writes and observer mutations.
 */
export function snapshotAudioMicrocode(ram, taskMem, imem) {
  const field = offset => taskMem.getU32(offset);
  const bootAddress = field(0x08) & 0x1fffffff;
  const codeAddress = field(0x10) & 0x1fffffff;
  const dataAddress = field(0x18) & 0x1fffffff;
  const declared = { boot: field(0x0c), code: field(0x14), data: field(0x1c) };
  const issues = [];
  const copy = (address, size, name) => {
    if (!address || !Number.isSafeInteger(size) || size <= 0 || size > 0x1000 || address + size > ram.length) {
      issues.push(`invalid-${name}-range`);
      return new Uint8Array();
    }
    return ram.slice(address, address + size);
  };
  // The CPU has already DMA'd the bootstrap into IMEM. Read that actual image:
  // a boot pointer can refer to cartridge memory (e.g. Conker), not RDRAM.
  const boot = imem.slice(0, 0x80);
  let loadAddress = null;
  let loader = 'unknown';
  let codeSize = declared.code > 0 && declared.code <= 0x1000 ? declared.code : 0x1000;
  if (hasStandardLoader(boot)) {
    loadAddress = 0x1080;
    codeSize = 0xf80;
    loader = 'rspboot';
  } else if (bootAddress === codeAddress && declared.boot === 0x1000 && imem.length === 0x1000) {
    loadAddress = 0x1000;
    codeSize = 0x1000;
    loader = 'direct';
  }
  // Preserve the evidence separately from the loader's interpretation. These
  // bounded windows include scratch/tail bytes on purpose: an offline analysis
  // must be able to revisit sizes, constants and currently unsupported loaders.
  // A window can be short at the end of RDRAM; the task header retains its pointer.
  const window = address => address > 0 && address < ram.length ? ram.slice(address, Math.min(address + 0x1000, ram.length)) : new Uint8Array();
  return {
    code: loader === 'direct' ? imem.slice() : copy(codeAddress, codeSize, 'code'), data: copy(dataAddress, declared.data, 'data'),
    loadAddress, loader, declared, issues,
    raw: { task: taskMem.u8.slice(), imem: imem.slice(), code: window(codeAddress), data: window(dataAddress) },
  };
}

// Recognize the expression used to dispatch 64-bit audio commands. The names
// below describe register roles, not fixed MIPS register numbers:
//
//   LW    command, displacement(base)
//   LW    arguments, displacement+4(base)
//   SRL   index, command, 23
//   ANDI  index, index, 0xfe
//   LH    handler, tableOffset(index)     // LHU is also accepted
//   JR    handler
//
// (command >>> 23) & 0xfe is ((command >>> 24) & 0x7f) * 2: the command
// number scaled for a table of 16-bit handler addresses. Recover tableOffset
// from the load's immediate; identifyAudioMicrocode later reads that DMEM table
// and validates its targets and handler behaviour. A matching shift alone is
// not enough evidence of a dispatcher.
function findDispatchers(code) {
  const data = view(code);
  const words = Array.from({ length: code.length >>> 2 }, (_, i) => data.getUint32(i * 4));
  const found = [];
  for (let start = 2; start < words.length; start++) {
    const first = words[start];
    if (!shift(first, SPECIAL_SRL, 23)) continue;
    const command = rt(first);
    // Require nearby loads of both command words from adjacent addresses on
    // the same base. The displacement need not be zero: some programs load
    // commands from fixed DMEM addresses using the architectural zero register.
    const loads = words.slice(Math.max(0, start - 4), start).filter(i => simpleOp(i) === OP_LW);
    const w0 = loads.find(i => rt(i) === command);
    const w1 = loads.find(i => w0 && rs(i) === rs(w0) && imms(i) === imms(w0) + 4 && rt(i) !== command);
    if (!w0 || !w1) continue;
    // Track only two symbolic values: the shifted command and the masked table
    // index. Keep the walk local and straight-line; unrelated counter updates
    // may be interleaved, but we do not follow branches or decode arbitrary code.
    const regs = new Map([[rd(first), 'shifted']]);
    for (let p = start + 1; p < Math.min(start + 14, words.length); p++) {
      const i = words[p];
      if (simpleOp(i) === OP_ANDI) {
        const value = imm(i) === 0xfe && regs.get(rs(i)) === 'shifted' ? 'index' : null;
        regs.set(rt(i), value);
      } else if (simpleOp(i) === OP_SPECIAL && [SPECIAL_ADD, SPECIAL_ADDU, SPECIAL_OR].includes(specialOp(i))) {
        // ADD/ADDU/OR with r0 can copy the expression into a different register.
        // Combining two nonzero registers no longer establishes its value.
        regs.set(rd(i), rs(i) === GPR_ZERO ? regs.get(rt(i)) : rt(i) === GPR_ZERO ? regs.get(rs(i)) : null);
      } else if ([OP_LH, OP_LHU].includes(simpleOp(i)) && regs.get(rs(i)) === 'index') {
        // The indexed halfword must feed the following register jump. Its
        // nonnegative displacement is the candidate table's offset in DMEM.
        const jump = words[p + 1];
        if (jump !== undefined && simpleOp(jump) === OP_SPECIAL && specialOp(jump) === SPECIAL_JR && rs(jump) === rt(i) && imms(i) >= 0) {
          found.push({ offset: start * 4, tableOffset: imm(i), commandRegister: command, argumentRegister: rt(w1) });
        }
        break;
      } else if ([OP_ADDI, OP_ADDIU].includes(simpleOp(i))) {
        // Tolerate pointer/counter increments, forgetting any expression they
        // overwrite. An increment of the index itself must invalidate it.
        regs.delete(rt(i));
      } else if (i !== INSTR_NOP) {
        break; // Do not follow branches or guess the effect of an instruction.
      }
    }
  }
  return found;
}

function handlerWords(code, loadAddress, address, count = 16) {
  const offset = address - loadAddress;
  if (offset < 0 || offset % 4 || offset + count * 4 > code.length) return [];
  const data = view(code);
  return Array.from({ length: count }, (_, i) => data.getUint32(offset + i * 4));
}

// SETBUFF stores input, output and count as adjacent halfwords. Track command
// operands through shifts/address-base additions; no register numbers or handler
// addresses are prescribed. The count comes from the low half of word 1.
function hasSetBuffer(words, command, argument) {
  const regs = new Map([[command, 'input'], [argument, 'count']]);
  const stores = [];
  let stopAfterDelay = false;
  for (const i of words) {
    if (shift(i, SPECIAL_SRL, 16)) regs.set(rd(i), rt(i) === argument ? 'output' : null);
    else if ([OP_ADDI, OP_ADDIU].includes(simpleOp(i))) regs.set(rt(i), regs.get(rs(i)));
    else if (simpleOp(i) === OP_SH) stores.push({ base: rs(i), offset: imms(i), value: regs.get(rt(i)) });
    else if (simpleOp(i) === OP_ANDI) regs.delete(rt(i));
    else if (simpleOp(i) === OP_SPECIAL && i !== INSTR_NOP) regs.delete(rd(i));
    else if ([OP_LB, OP_LH, OP_LW, OP_LBU, OP_LHU].includes(simpleOp(i))) regs.delete(rt(i));
    if (stopAfterDelay) break;
    if (simpleOp(i) === OP_J) stopAfterDelay = true;
  }
  return stores.some(a => a.value === 'input' && stores.some(b => b.base === a.base && b.offset === a.offset + 2 && b.value === 'output') &&
    stores.some(c => c.base === a.base && c.offset === a.offset + 4 && c.value === 'count'));
}

/** Fingerprint inputs exclude unrelated RAM after the program and mutable
 * scratch data copied alongside its constants. Follow static branches/calls
 * from entry and dispatcher targets, retaining addresses and delay slots. This
 * identifies the observed code/dispatch revision, not every possible overlay
 * or a proof of semantic equivalence. Non-dispatch indirect targets are not
 * inferred. Consumers record this scope alongside the resulting hash.
 */
export function audioMicrocodeIdentity(image, identification) {
  const { code, data, loadAddress } = image;
  const { handlers = [], tableOffset = 0, entries = 0 } = identification.evidence;
  if (loadAddress === null || code.length % 4) return { code, data: new Uint8Array(), scope: 'unresolved-code-image' };
  const dv = view(code);
  const pending = [loadAddress, ...handlers];
  const reached = new Map();
  const visited = new Set();
  const valid = pc => pc >= loadAddress && pc + 4 <= loadAddress + code.length && (pc & 3) === 0;
  while (pending.length) {
    const pc = pending.pop();
    if (!valid(pc) || visited.has(pc)) continue;
    visited.add(pc);
    const i = dv.getUint32(pc - loadAddress);
    reached.set(pc, i);
    const branch = simpleOp(i) === OP_REGIMM || [OP_BEQ, OP_BNE, OP_BLEZ, OP_BGTZ].includes(simpleOp(i));
    const indirect = simpleOp(i) === OP_SPECIAL && [SPECIAL_JR, SPECIAL_JALR].includes(specialOp(i));
    if (branch || indirect || simpleOp(i) === OP_J || simpleOp(i) === OP_JAL) {
      if (valid(pc + 4)) reached.set(pc + 4, dv.getUint32(pc + 4 - loadAddress));
      if (branch) {
        pending.push(branchAddress(pc, i));
        if (!(simpleOp(i) === OP_BEQ && rs(i) === rt(i))) pending.push(pc + 8);
      } else if (!indirect) {
        pending.push(jumpAddress(pc, i) & 0x1fff);
        if (simpleOp(i) === OP_JAL) pending.push(pc + 8);
      } else if (specialOp(i) === SPECIAL_JALR) pending.push(pc + 8);
    } else if (!(simpleOp(i) === OP_SPECIAL && specialOp(i) === SPECIAL_BREAK)) {
      pending.push(pc + 4);
    }
  }
  const bytes = new Uint8Array(reached.size * 8);
  const out = view(bytes);
  [...reached].sort(([a], [b]) => a - b).forEach(([address, instruction], index) => {
    out.setUint32(index * 8, address);
    out.setUint32(index * 8 + 4, instruction);
  });
  return { code: bytes, data: data.slice(tableOffset, tableOffset + entries * 2), scope: 'static-code-and-dispatch' };
}

function packedTransfer(words, command) {
  // n_audio packs byte count into word 0 bits 12..23, and DMEM offset into 0..11.
  const [left, right] = words;
  return left !== undefined && right !== undefined && shift(left, SPECIAL_SLL, 8) && rt(left) === command &&
    shift(right, SPECIAL_SRL, 20) && rt(right) === rd(left) && rd(right) === rd(left) &&
    words.some(i => (simpleOp(i) === OP_ANDI && rs(i) === command && imm(i) === 0xfff) ||
      ([OP_ADDI, OP_ADDIU].includes(simpleOp(i)) && rs(i) === command)); // Some revisions rely on DMEM address wrapping.
}

/** Identify an audio ABI from executable structure. This is deliberately not an
 * HLE compatibility guarantee. Observed code/dispatch revisions are fingerprinted by
 * the inventory collector, independently of these family-level observations.
 */
export function identifyAudioMicrocode({ code, data, loadAddress, loader, issues = [] }) {
  const result = { family: 'Unknown', detection: 'unknown', loader, loadAddress, evidence: {} };
  if (issues.length) return { ...result, detection: 'invalid', reason: issues.join(', ') };
  if (loadAddress === null) return { ...result, reason: 'unsupported-loader' };
  if (code.length % 4 || code.length < 64 || data.length < 32) return { ...result, detection: 'invalid', reason: 'truncated-image' };
  const candidates = [];
  for (const dispatch of findDispatchers(code)) {
    const { tableOffset, commandRegister, argumentRegister } = dispatch;
    if (tableOffset + 32 > data.length) continue;
    const dv = view(data);
    const table = [];
    const executable = address => address >= loadAddress && address < loadAddress + code.length && (address & 3) === 0;
    // A few n_audio opcode slots contain unused zero/scratch values. Require
    // real entry points in every slot used as classification evidence below.
    for (let i = 0; i < 32 && tableOffset + i * 2 + 2 <= data.length; i++) {
      const address = dv.getUint16(tableOffset + i * 2);
      if (i >= 16 && !executable(address)) break;
      table.push(address);
    }
    if (table.slice(0, 16).filter(executable).length < 12) continue;
    const handler = index => executable(table[index]) ? handlerWords(code, loadAddress, table[index]) : [];
    const setBuffer = hasSetBuffer(handler(8), commandRegister, argumentRegister);
    const fixedInterleave = handler(13).slice(0, 4).some(i => [OP_ADDI, OP_ADDIU, OP_ORI].includes(simpleOp(i)) && rs(i) === GPR_ZERO && imm(i) === 184 * 2);
    let family = 'Unknown';
    if (table.length === 16 && setBuffer && [4, 6].every(index => handler(index).some(i => [OP_LH, OP_LHU].includes(simpleOp(i)) && imm(i) === 4))) {
      family = 'ABI1';
    } else if (table.length === 16 && fixedInterleave && packedTransfer(handler(4), commandRegister) && packedTransfer(handler(6), commandRegister)) {
      family = 'NAUDIO';
    } else if (table.length >= 24 && setBuffer) {
      // Extended command layouts move LOADBUFF/SAVEBUFF to 20/21. Both call a
      // shared decoder extracting the packed count from word 0 bits 16..23.
      const load = handler(20)[0], save = handler(21)[0];
      if (load !== undefined && load === save && simpleOp(load) === OP_JAL) {
        const decoder = handlerWords(code, loadAddress, jumpAddress(loadAddress, load) & 0x1fff, 8);
        if (decoder.some(i => shift(i, SPECIAL_SRL, 12) && rt(i) === commandRegister) &&
            decoder.some(i => simpleOp(i) === OP_ANDI && imm(i) === 0xff0)) family = 'NEAD';
      }
    }
    candidates.push({ family, ...dispatch, entries: table.length, handlers: table, setBuffer, fixedInterleave });
  }
  if (candidates.length !== 1) return { ...result, reason: candidates.length ? 'ambiguous-dispatchers' : 'no-command-dispatcher' };
  const { family, ...evidence } = candidates[0];
  return { ...result, family, detection: family === 'Unknown' ? 'unknown' : 'structure',
    ...(family === 'Unknown' ? { reason: 'unrecognized-command-layout' } : {}), evidence };
}
