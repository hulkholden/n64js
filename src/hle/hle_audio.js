import { createAudioMicrocodeClassifier } from './audio_microcode_classifier.js';
import {
  ABI1Audio, COMMAND_BUFFER_SIZE, DMEM_COMMAND_BUFFER, DMEM_SEGMENT_TABLE, UnsupportedAudioCommand,
} from './audio_abi1.js';
import { TetrisphereAudio } from './audio_tetrisphere.js';
import { GoldenEyeAudio } from './audio_goldeneye.js';
import { DiddyBlastAudio } from './audio_diddy_blast.js';
import { TASK_OFFSET, TASK_SIZE, TASK_ADDRESS_MASK, TaskOffsets } from './rsp_task_constants.js';
import { SP_DMEM_SIZE, SP_IMEM_OFFSET, SP_SEMAPHORE_REG } from '../devices/sp_constants.js';
import { DPC_STATUS_DMA_BUSY } from '../devices/dpc_constants.js';
import * as logger from '../logger.js';
import { toHex } from '../format.js';

const OS_TASK_DP_WAIT = 0x0002;

// Scratch storage belongs to one hardware instance. Views are rebound when
// memory or microcode addresses change; classification still rechecks bytes on
// every task, including after reset and guest code/constants mutation.
const audioStates = new WeakMap();

function getAudioState(hardware, readMemory = true) {
  let state = audioStates.get(hardware);
  if (!state) {
    state = {
      classify: createAudioMicrocodeClassifier(),
      result: {},
      executors: new Map(),
      logged: new Map(),
      raw: {},
    };
    audioStates.set(hardware, state);
  }

  // Offline snapshots need the classifier without rebinding live memory views.
  if (!readMemory) return state;

  // Reuse SP views until the backing memory changes.
  const sp = hardware.sp_mem.u8, ram = hardware.ram.u8;
  if (state.sp !== sp) {
    state.sp = sp;
    state.dmem = sp.subarray(0, SP_DMEM_SIZE);
    state.raw.task = sp.subarray(TASK_OFFSET, TASK_OFFSET + TASK_SIZE);
    state.task = new DataView(sp.buffer, sp.byteOffset + TASK_OFFSET, TASK_SIZE);
    state.raw.imem = sp.subarray(SP_IMEM_OFFSET);
  }

  // Code and constants can move independently between tasks.
  const codeAddress = state.task.getUint32(TaskOffsets.ucodePtr) & TASK_ADDRESS_MASK;
  const dataAddress = state.task.getUint32(TaskOffsets.ucodeDataPtr) & TASK_ADDRESS_MASK;
  if (state.ram !== ram || state.codeAddress !== codeAddress) {
    state.raw.code = ram.subarray(codeAddress, codeAddress + 4096);
    state.codeAddress = codeAddress;
  }

  if (state.ram !== ram || state.dataAddress !== dataAddress) {
    state.raw.data = ram.subarray(dataAddress, dataAddress + 4096);
    state.dataAddress = dataAddress;
  }

  state.ram = ram;
  return state;
}

// Offline capture callers retain owned copies. Runtime dispatch uses the live
// views above synchronously, before any HLE stores can alter task memory.
export function captureAudioTask(hardware) {
  const task = hardware.sp_mem.u8.slice(TASK_OFFSET, TASK_OFFSET + TASK_SIZE);
  const view = new DataView(task.buffer);

  // Loaders may transfer more bytes than the task's declared microcode sizes.
  const ram = hardware.ram.u8;
  const window = offset => {
    const address = view.getUint32(offset) & TASK_ADDRESS_MASK;
    return ram.slice(address, address + 4096);
  };

  return {
    task,
    imem: hardware.sp_mem.u8.slice(SP_IMEM_OFFSET),
    code: window(TaskOffsets.ucodePtr),
    data: window(TaskOffsets.ucodeDataPtr),
  };
}

export function classifyAudioTask(hardware, raw) {
  const state = getAudioState(hardware, raw === undefined);
  return state.classify(raw === undefined ? state.raw : raw);
}

function audioMicrocodeInfo(identity) {
  return identity.status === 'known'
    ? { family: identity.family, detection: 'hash', identity: identity.identity }
    : { family: 'Unknown', detection: 'unknown' };
}

function logAudioTask(state, identity, requestedMode, handled) {
  let key = identity.identity;
  if (key === null) {
    // Diagnostic hash only; HLE selection always uses the reviewed identity.
    let hash = 0, size = state.task.getUint32(TaskOffsets.ucodeSize);
    if (!size || size > 4096) size = 4096;

    for (let i = 0; i < size; i++) hash = (hash * 17 + state.raw.code[i]) >>> 0;
    key = hash;
  }

  // Track each execution path separately for a given microcode.
  const bit = requestedMode === 'Disabled' ? 8 : handled ? 1 : requestedMode === 'HLE' ? 4 : 2;
  const seen = state.logged.get(key) ?? 0;
  if (seen & bit) return;
  state.logged.set(key, seen | bit);

  // Build strings only for the first occurrence of this path.
  const description = identity.identity
    ? `${identity.identity} (${identity.family})`
    : `Unknown (code hash ${toHex(key, 32)})`;
  const mode = requestedMode === 'Disabled' ? 'Disabled' : handled ? 'HLE' : 'LLE';
  const fallback = requestedMode === 'HLE' && !handled ? ' (HLE fallback)' : '';
  logger.log(`RSP audio microcode ${description}: ${mode}${fallback}`);
}

// Classify once on the normal path. Observers still receive a fresh owned
// object before execution, and cannot mutate the classifier's reusable result.
export function dispatchAudioTask(hardware, mode) {
  let state = getAudioState(hardware);
  let identity = state.classify(state.raw, state.result);

  if (hardware.onAudioTask) {
    hardware.onAudioTask(audioMicrocodeInfo(identity));

    // Observers may inspect or modify memory. Never use a stale classification
    // to execute HLE after handing control to external code.
    if (mode === 'HLE') {
      state = getAudioState(hardware);
      identity = state.classify(state.raw, state.result);
    }
  }

  // Disabled skips execution; a false result hands the task back to LLE.
  const handled = mode === 'Disabled' || (mode === 'HLE' && executeAudioTask(hardware, state, identity));
  logAudioTask(state, identity, mode, handled);
  return handled;
}

// Select by exact reviewed executable identity, never by ROM name or family.
export function getAudioHLEClass(identity) {
  switch (identity) {
    case 'abi1-standard-mixer': return ABI1Audio;
    case 'abi1-tetrisphere-us-mixer': return TetrisphereAudio;
    case 'abi1-goldeneye-mixer': return GoldenEyeAudio;
    case 'abi1-diddy-blast-mixer': return DiddyBlastAudio;
    default: return null;
  }
}

/** Return false with memory untouched when the identity or command domain has
 * not been reviewed. The caller then executes the entire original task on RSP.
 * This is opt-in; LLE remains the default audio mode.
 */
export function hleProcessAudioTask(hardware) {
  const state = getAudioState(hardware);
  const identity = state.classify(state.raw, state.result);
  return executeAudioTask(hardware, state, identity);
}

function executeAudioTask(hardware, state, identity) {
  if (identity.status !== 'known') return false;
  const Audio = getAudioHLEClass(identity.identity);
  if (!Audio) return false;

  const task = state.task;
  // Only fresh rspboot tasks have been derived. Yield/resume and manually
  // selected RSP entry points must execute their actual instructions.
  const flags = task.getUint32(TaskOffsets.flags);
  if (hardware.rsp.pc !== 0 || (flags & ~OS_TASK_DP_WAIT)) return false;

  if (flags & OS_TASK_DP_WAIT) {
    // Diddy's rspboot-208 tests this flag at 0x1068 and DPC DMA busy at
    // 0x1080–0x1088. Only bypass that wait when it is already satisfied.
    const status = hardware.dpcDevice?.statusReg;
    if (identity.bootstrap !== 'rspboot-208' || status === undefined || (status & DPC_STATUS_DMA_BUSY)) return false;
  }

  // Validate the command list before modifying any emulated memory.
  const pointer = task.getUint32(TaskOffsets.dataPtr) & TASK_ADDRESS_MASK;
  const size = task.getUint32(TaskOffsets.dataSize);
  if (!size || size % 8 || size > 0x10000 || pointer % 8 || pointer + size > hardware.ram.u8.length) return false;

  // Retain each variant's handler and scratch buffers between tasks.
  let audio = state.executors.get(Audio);
  if (!audio) {
    audio = new Audio(state.ram, state.dmem);
    state.executors.set(Audio, audio);
  } else {
    audio.reset(state.ram, state.dmem);
  }

  try {
    // Reproduce the task loader's DMEM initialization.
    audio.dma(0, task.getUint32(TaskOffsets.ucodeDataPtr) & TASK_ADDRESS_MASK, task.getUint32(TaskOffsets.ucodeDataSize));

    // 0x10c0–0x10d0 repeatedly stores at the SAME address, clearing segment 0.
    audio.view.setUint32(DMEM_SEGMENT_TABLE, 0);

    // Load command batches in the same order as the microcode.
    for (let p = 0; p < size; p += COMMAND_BUFFER_SIZE) {
      const bytes = Math.min(COMMAND_BUFFER_SIZE, size - p);
      audio.dma(DMEM_COMMAND_BUFFER, pointer + p, bytes);

      for (let i = 0; i < bytes; i += 8) {
        const command = DMEM_COMMAND_BUFFER + i;
        // Handlers decode packed words with shifts/masks. Signed reads preserve
        // those bits and avoid boxing high-bit words (e.g. negative envelope
        // increments) when passing arguments across the handler call boundary.
        audio.execute(audio.view.getInt32(command), audio.view.getInt32(command + 4));
      }
    }
  } catch (error) {
    // Undo partial RDRAM writes so LLE can rerun the original task unchanged.
    audio.rollback();
    if (error instanceof UnsupportedAudioCommand) return false;
    throw error;
  }

  // Publish DMEM only after every command succeeds.
  hardware.sp_mem.u8.set(audio.dmem);
  audio.commit();
  hardware.spRegDevice.writeReg32(SP_SEMAPHORE_REG, 0); // Task completion releases semaphore.
  return true;
}
