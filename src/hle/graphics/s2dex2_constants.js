import * as gbi from './gbi.js';

// S2DEX2 display-list opcodes.
export const Commands = Object.freeze({
  ...gbi.Commands,
  G_OBJ_RECTANGLE: 0x01,
  G_OBJ_SPRITE: 0x02,
  G_SELECT_DL: 0x04,
  G_OBJ_LOAD_TXTR: 0x05,
  G_OBJ_LOAD_TX_SPRITE: 0x06,
  G_OBJ_LOAD_TX_RECT: 0x07,
  G_OBJ_LOAD_TX_RECT_R: 0x08,
  G_BG_1CYC: 0x09,
  G_BG_COPY: 0x0a,
  G_OBJ_RENDERMODE: 0x0b,
  G_OBJ_RECTANGLE_R: 0xda,
});
