import * as logger from '../logger.js';
import { toString32 } from '../format.js';
import { GBI0, GBI0GE, GBI0PD, GBI0SE, GBI0WR } from './gbi0.js';
import { GBI0DKR } from './gbi0_dkr.js';
import { GBI1TEXA } from './gbi1_texa.js';
import { GBI1, GBI1LL } from './gbi1.js';
import { GBI1L3DEX } from './gbi_l3dex.js';
import { GBI2, GBI2Conker } from './gbi2.js';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';
import { graphicsOptions } from './graphics_options.js';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';
import { Turbo3D } from './turbo3d.js';
import { T3DUX } from './t3dux.js';

class UnsupportedMicrocodeError extends Error {
  constructor(info) {
    super(`Unsupported graphics microcode: ${info.family} (version "${info.version}", hash ${toString32(info.hash)}); HLE is not implemented`);
    this.name = 'UnsupportedMicrocodeError';
  }
}

export function assertHLESupported(info) {
  // These families have their own command formats and SP signal protocols.
  // Falling back to GBI0 reads unrelated data as commands; skipping execution
  // and signalling task completion cannot satisfy their CPU/RSP handshake.
  if (info.id === MicrocodeId.ZSORTP || info.id === MicrocodeId.ZSORT_BOSS || info.id === MicrocodeId.F5_ROGUE) {
    throw new UnsupportedMicrocodeError(info);
  }
}

// The optional observer receives the already-computed classification after
// construction, so changing its snapshot cannot affect handler selection.
export function create(task, state, ramDV, onMicrocodeLoad = null) {
  const version = task.detectVersionString();

  const dumpStr = graphicsOptions.dumpMicrocodeSubstring;
  if (graphicsOptions.dumpMicrocode && (dumpStr == '' || version.includes(dumpStr))) {
    task.dumpCode();
    graphicsOptions.dumpMicrocode = false;
  }

  const hash = task.computeMicrocodeHash();
  const info = identifyMicrocode(version, hash);
  logMicrocode(version, info.id);
  // Check in-list loads as well as the initial task dispatch.
  assertHLESupported(info);
  const microcode = createMicrocode(info.id, state, ramDV);
  microcode.version = version;
  onMicrocodeLoad?.(info);
  return microcode;
}

function createMicrocode(ucode, state, ramDV) {
  switch (ucode) {
    case MicrocodeId.GBI0:
      return new GBI0(state, ramDV);
    case MicrocodeId.GBI0_DKR:
      return new GBI0DKR(state, ramDV);
    case MicrocodeId.GBI0_SE:
      return new GBI0SE(state, ramDV);
    case MicrocodeId.GBI0_PD:
      return new GBI0PD(state, ramDV);
    case MicrocodeId.GBI0_GE:
      return new GBI0GE(state, ramDV);
    case MicrocodeId.GBI0_WR:
      return new GBI0WR(state, ramDV);
    case MicrocodeId.GBI1_L3DEX:
      return new GBI1L3DEX(state, ramDV);
    case MicrocodeId.GBI1:
      return new GBI1(state, ramDV);
    case MicrocodeId.GBI1_TEXA:
      return new GBI1TEXA(state, ramDV);
    case MicrocodeId.GBI1_LL:
      return new GBI1LL(state, ramDV);
    case MicrocodeId.T3DUX:
      return new T3DUX(state, ramDV, true);
    case MicrocodeId.T3DUX_BRAVE:
      return new T3DUX(state, ramDV, false);
    case MicrocodeId.TURBO3D:
      return new Turbo3D(state, ramDV);
    case MicrocodeId.GBI1_SDEX:
      return new GBI1SDEX(state, ramDV);
    case MicrocodeId.GBI2:
      return new GBI2(state, ramDV);
    case MicrocodeId.GBI2_CONKER:
      return new GBI2Conker(state, ramDV);
    case MicrocodeId.GBI2_SDEX:
      return new GBI2SDEX(state, ramDV);
  }
  logger.log(`unhandled ucode during table init: ${ucode}`);
  return new GBI0(state, ramDV);
}

const loggedMicrocodes = new Map();

function logMicrocode(version, ucode) {
  if (loggedMicrocodes.get(version)) {
    return;
  }
  loggedMicrocodes.set(version, true);
  logger.log(`New RSP graphics ucode seen: ${version} = ucode ${ucode}`);
}
