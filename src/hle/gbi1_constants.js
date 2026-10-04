import * as gbi from './gbi.js';

// GBI1 display-list opcodes.
export const Commands = Object.freeze({
  ...gbi.Commands,
  G_SPNOOP: 0x00,
  G_MTX: 0x01,
  G_MOVEMEM: 0x03,
  G_VTX: 0x04,
  G_DL: 0x06,
  G_SPRITE2D_BASE: 0x09,
  G_LOAD_UCODE: 0xaf,
  G_BRANCH_Z: 0xb0,
  G_TRI2: 0xb1,
  G_MODIFYVTX: 0xb2,
  G_RDPHALF_CONT: 0xb2, // GBI0 uses this slot for continuation instead of ModifyVtx.
  G_RDPHALF_2: 0xb3,
  G_RDPHALF_1: 0xb4,
  G_LINE3D: 0xb5,
  G_CLEARGEOMETRYMODE: 0xb6,
  G_SETGEOMETRYMODE: 0xb7,
  G_ENDDL: 0xb8,
  G_SETOTHERMODE_L: 0xb9,
  G_SETOTHERMODE_H: 0xba,
  G_TEXTURE: 0xbb,
  G_MOVEWORD: 0xbc,
  G_POPMTX: 0xbd,
  G_CULLDL: 0xbe,
  G_TRI1: 0xbf,
  G_NOOP: gbi.Commands.Nop,
});
