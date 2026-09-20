/* global n64js */

import { compatibilityHacks } from './compatibility_hacks.js';
import { toString32 } from './format.js';
import * as logger from './logger.js';

function kseg0ToRamOffset(address) {
  return address - 0x80000000;
}

export function getCompatibilityHacks(romId) {
  const config = compatibilityHacks[romId];
  if (!config?.enabled) return null;

  // Each CPU/reset owns one pending map. Delays stay per instruction; the first
  // patch address triggers validation and application of the entire patch set.
  // Add delays first so a delay at the trigger sees the original instruction.
  const pending = new Map();
  for (const entry of config.instructionDelays ?? []) {
    add({ ...entry, type: 'delay' });
  }
  const patches = config.instructionPatches;
  if (patches?.length) {
    add({ ...patches[0], patches, type: 'patch' });
  }
  return pending.size ? pending : null;

  function add(entry) {
    let hacks = pending.get(entry.address);
    if (!hacks) {
      hacks = [];
      pending.set(entry.address, hacks);
    }
    hacks.push({ ...entry, name: config.name });
  }
}

export function applyCompatibilityHacks(pending, ram, address, instruction) {
  const hacks = pending.get(address);
  if (!hacks) return null;

  // Let the debugger stop normally. Single-stepping/removing the breakpoint
  // restores the original instruction, so pending hacks can be checked then.
  if (n64js.breakpoints().isBreakpoint(address)) return null;

  pending.delete(address);
  let patchedInstruction = instruction;
  let codeChanged = false;
  let cycles = 0;
  for (const hack of hacks) {
    if (instruction !== hack.expected) {
      logger.warn(`Skipped compatibility ${hack.type} for ${hack.name} at ${toString32(address)}: expected ${toString32(hack.expected)}, found ${toString32(instruction)}`);
      continue;
    }

    switch (hack.type) {
      case 'delay':
        cycles += hack.cycles;
        logger.log(`Applied compatibility delay for ${hack.name} at ${toString32(address)}: ${hack.cycles} CPU cycles`);
        break;
      case 'patch':
        // Validate the whole set before writing anything. All sites must be
        // loaded when the trigger executes; a mismatch consumes the set once.
        if (hack.patches.some(patch => ram.getU32(kseg0ToRamOffset(patch.address)) !== patch.expected)) {
          logger.warn(`Skipped compatibility patch set for ${hack.name} at ${toString32(address)}: instruction mismatch`);
          continue;
        }
        for (const patch of hack.patches) {
          ram.set32(kseg0ToRamOffset(patch.address), patch.replacement);
          codeChanged ||= patch.replacement !== patch.expected;
          // A delay at another member still belongs to that instruction's
          // first execution. Keep its fingerprint aligned with our own patch.
          for (const delay of pending.get(patch.address) ?? []) {
            if (delay.type === 'delay' && delay.expected === patch.expected) {
              delay.expected = patch.replacement;
            }
          }
        }
        patchedInstruction = hack.replacement;
        logger.log(`Applied compatibility patch set for ${hack.name} at ${toString32(address)}`);
        break;
    }
  }
  return { instruction: patchedInstruction, cycles, codeChanged };
}
