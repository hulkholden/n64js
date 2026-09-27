#!/usr/bin/env bun
import { createReplay } from './rsp_replay.js';
import { classifyAudioTask, getAudioHLEClass, hleProcessAudioTask } from '../../src/hle/hle_audio.js';

export async function readCapture(prefix) {
  const read = async key => new Uint8Array(await Bun.file(`${prefix}-${key}.bin`).arrayBuffer());
  return { ram: await read('ram'), dmem: await read('dmem'), imem: await read('imem') };
}

export function validateCapture(raw) {
  const ram = raw.ram.slice();
  const oracle = createReplay({ ...raw, ram });
  const { rsp } = oracle;
  // Exercise the actual task dispatcher separately, including bootstrap data
  // loading and 320-byte command batches, rather than only individual handlers.
  const integratedRam = raw.ram.slice();
  const sp = new Uint8Array(8192);
  sp.set(raw.dmem); sp.set(raw.imem, 4096);
  const hardware = {
    ram: { u8: integratedRam }, sp_mem: { u8: sp }, rsp: { pc: 0 },
    spRegDevice: { writeReg32() {} },
  };
  const identity = classifyAudioTask(hardware);
  if (!hleProcessAudioTask(hardware)) throw new Error('Capture fell back to LLE');
  const Audio = getAudioHLEClass(identity.identity);
  let hle, command, commands = 0, instructions = 0;
  const opcodes = {};
  while (!rsp.halted && instructions++ < 10_000_000) {
    if (rsp.pc === 0xe4 && !hle) hle = new Audio(ram.slice(), rsp.dmem.u8);
    if (rsp.pc === 0x10c) {
      command = [rsp.gprU32[26], rsp.gprU32[25]];
      opcodes[command[0] >>> 24] = (opcodes[command[0] >>> 24] ?? 0) + 1;
      hle.execute(...command);
    }
    if (rsp.pc === 0x118 && command) {
      const fail = (space, p, expected, actual) => {
        throw new Error(`Command ${commands} (${command.map(x => x.toString(16))}): ${space} ${p.toString(16)}: RSP ${expected}, HLE ${actual}`);
      };
      // Parameters, predictor book and sample buffers. Instruction-private
      // temporaries/registers are deliberately not part of the HLE contract.
      for (const [start, end] of [[0x320, 0x380], [0x4c0, 0xf90]]) {
        for (let p = start; p < end; p++) if (rsp.dmem.u8[p] !== hle.dmem[p]) fail('DMEM', p, rsp.dmem.u8[p], hle.dmem[p]);
      }
      for (const { address, size } of oracle.writes) {
        for (let p = address; p < address + size; p++) if (ram[p] !== hle.ram[p]) fail('RDRAM', p, ram[p], hle.ram[p]);
      }
      oracle.writes.length = 0;
      hle.writes.length = 0;
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
  for (const prefix of Bun.argv.slice(2)) console.log(JSON.stringify({ prefix, ...validateCapture(await readCapture(prefix)) }));
}
