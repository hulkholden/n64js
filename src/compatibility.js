/* global n64js */

import { compatibilityHacks } from './compatibility_hacks.js';
import { toString32 } from './format.js';
import * as logger from './logger.js';

export function getInstructionPatches(romId) {
  return getOverrides(romId, 'instructionPatches');
}

export function getInstructionDelays(romId) {
  return getOverrides(romId, 'instructionDelays');
}

function getOverrides(romId, kind) {
  const config = compatibilityHacks[romId];
  if (!config?.enabled || !config[kind]?.length) return null;
  // Each CPU/reset owns its pending set; never consume the shared config.
  return new Map(config[kind].map(patch => [patch.address, { ...patch, name: config.name }]));
}

export function takeInstructionDelay(pending, address, instruction) {
  const delay = pending.get(address);
  if (!delay || n64js.breakpoints().isBreakpoint(address)) return 0;
  pending.delete(address);
  if (instruction !== delay.expected) {
    logger.warn(`Skipped compatibility delay for ${delay.name} at ${toString32(address)}: expected ${toString32(delay.expected)}, found ${toString32(instruction)}`);
    return 0;
  }
  logger.log(`Applied compatibility delay for ${delay.name} at ${toString32(address)}: ${delay.cycles} CPU cycles`);
  return delay.cycles;
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
