import * as logger from '../../logger.js';
import { toString32 } from '../../format.js';
import { GBI0, GBI0Early, GBI0GE, GBI0PD, GBI0SE, GBI0WR } from './microcodes/gbi0.js';
import { GBI0DKR } from './microcodes/gbi0_dkr.js';
import { GBI1TEXA } from './microcodes/gbi1_texa.js';
import { GBI1, GBI1LL } from './microcodes/gbi1.js';
import { GBI1L3DEX, GBI2L3DEX } from './microcodes/gbi_l3dex.js';
import { GBI2 } from './microcodes/gbi2.js';
import { GBI2Conker } from './microcodes/gbi2_conker.js';
import { GBI2FLX } from './microcodes/gbi2_flx.js';
import { GBI1SDEX, GBI2SDEX } from './microcodes/gbi_s2dex.js';
import { graphicsOptions } from './graphics_options.js';
import { identifyMicrocode, MicrocodeId, microcodePrefixLength } from './microcode_identifier.js';
import { Turbo3D } from './microcodes/turbo3d.js';
import { T3DUX } from './microcodes/t3dux.js';
import { ZSortP } from './microcodes/zsortp.js';
import { Sprite2D } from './microcodes/sprite2d.js';

const unsupportedHLEMicrocodes = new Set([
  MicrocodeId.ZSORT_BOSS,
  MicrocodeId.F5_INDI,
  MicrocodeId.F5_ROGUE,
  MicrocodeId.F5_NABOO,
  MicrocodeId.HVQM2,
]);

class UnsupportedMicrocodeError extends Error {
  constructor(info) {
    const variant = info.variant ? `/${info.variant}` : '';
    super(`Unsupported graphics microcode: ${info.family}${variant} (version "${info.version}", hash ${toString32(info.hash)}); HLE is not implemented`);
    this.name = 'UnsupportedMicrocodeError';
  }
}

export function assertHLESupported(info) {
  // These families have their own command formats and SP signal protocols.
  // Falling back to GBI0 reads unrelated data as commands; skipping execution
  // and signalling task completion cannot satisfy their CPU/RSP handshake.
  // LLE fallback is only safe at task start, before any HLE execution.
  if (unsupportedHLEMicrocodes.has(info.id)) {
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
  const info = identifyMicrocode(version, hash, () => task.computeMicrocodeHash(microcodePrefixLength));
  logMicrocode(version, info.id);
  // Check in-list loads as well as the initial task dispatch.
  assertHLESupported(info);
  const microcode = createMicrocode(info.id, state, ramDV);
  microcode.version = version;
  // Reinterpret retained geometry bits when switching to/from variants such
  // as F3DFLX, where G_TEXTURE_GEN generates alpha rather than UVs.
  if (microcode.geometryModeFlags) {
    state.updateGeometryModeFromBits(microcode.geometryModeFlags);
  }
  // NoN microcodes draw geometry between the eye and the near plane. Update
  // on every load, including switches back to ordinary microcode within a task.
  // See https://github.com/gonetz/GLideN64/blob/master/src/GBI.cpp (NoN).
  state.noNearClipping = version.includes('.NoN');
  onMicrocodeLoad?.(info);
  return microcode;
}

function createMicrocode(ucode, state, ramDV) {
  switch (ucode) {
    case MicrocodeId.SPRITE2D:
      return new Sprite2D(state, ramDV);
    case MicrocodeId.ZSORTP:
      return new ZSortP(state, ramDV);
    case MicrocodeId.GBI0:
      return new GBI0(state, ramDV);
    case MicrocodeId.GBI0_EARLY:
      return new GBI0Early(state, ramDV);
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
    case MicrocodeId.GBI2_L3DEX:
      return new GBI2L3DEX(state, ramDV);
    case MicrocodeId.GBI2:
      return new GBI2(state, ramDV);
    case MicrocodeId.GBI2_FLX:
      return new GBI2FLX(state, ramDV);
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
