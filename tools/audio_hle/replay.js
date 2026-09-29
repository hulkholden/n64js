#!/usr/bin/env bun
import { createReplay } from './rsp_replay.js';
import { classifyAudioTask, getAudioHLEClass, hleProcessAudioTask } from '../../src/hle/hle_audio.js';

export async function readCapture(prefix) {
  const read = async key => new Uint8Array(await Bun.file(`${prefix}-${key}.bin`).arrayBuffer());
  return { ram: await read('ram'), dmem: await read('dmem'), imem: await read('imem') };
}

function createHLEHardware() {
  return {
    ram: { u8: new Uint8Array(0) }, sp_mem: { u8: new Uint8Array(8192) }, rsp: { pc: 0 },
    dpcDevice: { statusReg: 0 },
    spRegDevice: { readRegU32: () => 0, writeReg32() {} },
  };
}

export function validateCapture(raw, hardware = createHLEHardware()) {
  const ram = raw.ram.slice();
  const oracle = createReplay({ ...raw, ram });
  const { rsp } = oracle;
  // Exercise the actual task dispatcher separately, including bootstrap data
  // loading and 320-byte command batches, rather than only individual handlers.
  if (hardware.ram.u8.length !== raw.ram.length) hardware.ram.u8 = new Uint8Array(raw.ram.length);
  const integratedRam = hardware.ram.u8;
  integratedRam.set(raw.ram);
  const sp = hardware.sp_mem.u8;
  sp.set(raw.dmem); sp.set(raw.imem, 4096);
  const identity = classifyAudioTask(hardware);
  if (!hleProcessAudioTask(hardware)) throw new Error('Capture fell back to LLE');
  const Audio = getAudioHLEClass(identity.identity);
  const naudio = identity.family === 'NAUDIO';
  const dispatchPC = identity.identity === 'naudio-donkey-kong-64' ? 0xdc
    : identity.identity === 'naudio-banjo-kazooie' ? 0xe4 : naudio ? 0xe0 : 0x10c;
  const returnPC = identity.identity === 'naudio-donkey-kong-64' ? 0xe8
    : identity.identity === 'naudio-banjo-kazooie' ? 0xf0 : naudio ? 0xec : 0x118;
  const memoryRanges = naudio ? [[0xe, 0x12], [0x3f0, 0xfa0], [0xfe0, 0xff2]]
    : [[0x320, 0x380], [0x4c0, 0xf90]];
  let hle, command, commands = 0, instructions = 0;
  const opcodes = {};
  while (!rsp.halted && instructions++ < 10_000_000) {
    if (rsp.pc === (naudio ? dispatchPC : 0xe4) && !hle) hle = new Audio(ram.slice(), rsp.dmem.u8);
    if (naudio && rsp.pc === 0xc0 && hle) hle.beginCommandBatch();
    if (rsp.pc === dispatchPC) {
      command = [rsp.gprU32[26], rsp.gprU32[25]];
      opcodes[command[0] >>> 24] = (opcodes[command[0] >>> 24] ?? 0) + 1;
      hle.execute(...command);
    }
    if (rsp.pc === returnPC && command) {
      const fail = (space, p, expected, actual) => {
        throw new Error(`Command ${commands} (${command.map(x => x.toString(16))}): ${space} ${p.toString(16)}: RSP ${expected}, HLE ${actual}`);
      };
      // Parameters, predictor book and sample buffers. Instruction-private
      // temporaries/registers are deliberately not part of the HLE contract.
      for (const [start, end] of memoryRanges) {
        for (let p = start; p < end; p++) if (rsp.dmem.u8[p] !== hle.dmem[p]) fail('DMEM', p, rsp.dmem.u8[p], hle.dmem[p]);
      }
      for (const { address, size } of oracle.writes) {
        for (let p = address; p < address + size; p++) if (ram[p] !== hle.ram[p]) fail('RDRAM', p, ram[p], hle.ram[p]);
      }
      oracle.writes.length = 0;
      hle.commit();
      commands++;
      command = null;
    }
    rsp.step();
  }
  if (!rsp.halted) throw new Error('RSP instruction budget exhausted');
  // Also catches extra/missing writes and command-list aliasing mistakes.
  if (Buffer.compare(ram, integratedRam)) {
    const first = ram.findIndex((v, i) => v !== integratedRam[i]);
    throw new Error(`Integrated task differs at RDRAM ${first.toString(16)}`);
  }
  return { identity: identity.identity, commands, instructions, opcodes };
}

if (import.meta.main) {
  if (!Bun.argv[2]) throw new Error('Usage: bun tools/audio_hle/replay.js <capture-prefix> [...]');
  // Keep one runtime across tasks and identity changes to catch stale scratch,
  // journal, memory-view and classifier state in addition to DSP differences.
  const hardware = createHLEHardware();
  for (const prefix of Bun.argv.slice(2)) console.log(JSON.stringify({ prefix, ...validateCapture(await readCapture(prefix), hardware) }));
}
