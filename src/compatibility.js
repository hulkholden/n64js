/* global n64js */

import { compatibilityHacks } from './compatibility_hacks.js';
import { toString32 } from './format.js';
import * as logger from './logger.js';

export function getCompatibilityHacks(romId) {
  const config = compatibilityHacks[romId];
  if (!config?.enabled) return null;

  // Each CPU/reset owns one pending map. Group entries by address so a delay
  // and patch at the same site are both checked against the original word.
  const pending = new Map();
  for (const [type, entries] of [['delay', config.instructionDelays], ['patch', config.instructionPatches]]) {
    for (const entry of entries ?? []) {
      let hacks = pending.get(entry.address);
      if (!hacks) {
        hacks = [];
        pending.set(entry.address, hacks);
      }
      hacks.push({ ...entry, type, name: config.name });
    }
  }
  return pending.size ? pending : null;
}

export function applyCompatibilityHacks(pending, ram, address, instruction) {
  const hacks = pending.get(address);
  if (!hacks) return null;

  // Let the debugger stop normally. Single-stepping/removing the breakpoint
  // restores the original instruction, so pending hacks can be checked then.
  if (n64js.breakpoints().isBreakpoint(address)) return null;

  pending.delete(address);
  let patchedInstruction = instruction;
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
        // Some workarounds change a pair of instructions that must agree.
        // Check every companion before writing any of them, so a modified
        // guest cannot receive half of a patch. The caller flushes compiled
        // fragments when the triggering instruction changes.
        if (hack.additionalPatches?.some(patch => ram.getU32(patch.address - 0x80000000) !== patch.expected)) {
          logger.warn(`Skipped compatibility patch for ${hack.name} at ${toString32(address)}: companion instruction mismatch`);
          continue;
        }
        for (const patch of hack.additionalPatches ?? []) {
          ram.set32(patch.address - 0x80000000, patch.replacement);
        }
        ram.set32(address - 0x80000000, hack.replacement);
        patchedInstruction = hack.replacement;
        logger.log(`Applied compatibility patch for ${hack.name} at ${toString32(address)}`);
        break;
    }
  }
  return { instruction: patchedInstruction, cycles };
}
