import * as logger from '../logger.js';
import { GBI0, GBI0GE, GBI0PD, GBI0SE, GBI0WR } from './gbi0.js';
import { GBI0DKR } from './gbi0_dkr.js';
import { GBI1, GBI1LL } from './gbi1.js';
import { GBI2, GBI2Conker } from './gbi2.js';
import { GBI1SDEX, GBI2SDEX } from './gbi_s2dex.js';
import { graphicsOptions } from './graphics_options.js';
import { identifyMicrocode, MicrocodeId } from './microcode_identifier.js';

export function create(task, state, ramDV) {
  const version = task.detectVersionString();

  const dumpStr = graphicsOptions.dumpMicrocodeSubstring;
  if (graphicsOptions.dumpMicrocode && (dumpStr == '' || version.includes(dumpStr))) {
    task.dumpCode();
    graphicsOptions.dumpMicrocode = false;
  }

  const hash = task.computeMicrocodeHash();
  const info = identifyMicrocode(version, hash);
  logMicrocode(version, info.id);
  const microcode = createMicrocode(info.id, state, ramDV);
  microcode.version = version;
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
    case MicrocodeId.GBI1:
      return new GBI1(state, ramDV);
    case MicrocodeId.GBI1_LL:
      return new GBI1LL(state, ramDV);
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
