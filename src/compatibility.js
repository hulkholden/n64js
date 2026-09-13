/* global n64js */

import { compatibilityHacks } from './compatibility_hacks.js';
import { toString32 } from './format.js';
import * as logger from './logger.js';

export function getInstructionPatches(romId) {
  const config = compatibilityHacks[romId];
  if (!config?.enabled || !config.instructionPatches?.length) return null;
  // Each CPU/reset owns its pending set; never consume the shared config.
  return new Map(config.instructionPatches.map(patch => [patch.address, { ...patch, name: config.name }]));
}

export function patchInstruction(pending, ram, address, instruction) {
  const patch = pending.get(address);
  if (!patch) return instruction;

  // Let the debugger stop normally. Single-stepping/removing the breakpoint
  // restores the original instruction, so the pending patch can be checked then.
  if (n64js.breakpoints().isBreakpoint(address)) return instruction;

  pending.delete(address);
  if (instruction !== patch.expected) {
    logger.warn(`Skipped compatibility patch for ${patch.name} at ${toString32(address)}: expected ${toString32(patch.expected)}, found ${toString32(instruction)}`);
    return instruction;
  }

  ram.set32(address - 0x80000000, patch.replacement);
  logger.log(`Applied compatibility patch for ${patch.name} at ${toString32(address)}`);
  return patch.replacement;
}
