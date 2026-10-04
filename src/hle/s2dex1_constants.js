import { GBIRDPCommands } from '../lle/rdp_constants.js';

// S2DEX1 display-list opcodes.
export const Commands = Object.freeze({
  G_BG_1CYC: 0x01,
  G_BG_COPY: 0x02,
  G_OBJ_RECTANGLE: 0x03,
  G_OBJ_SPRITE: 0x04,
  G_OBJ_MOVEMEM: 0x05,
  G_SELECT_DL: 0xb0,
  G_OBJ_RENDERMODE: 0xb1,
  G_OBJ_RECTANGLE_R: 0xb2,
  G_OBJ_LOAD_TXTR: 0xc1,
  G_OBJ_LOAD_TX_SPRITE: 0xc2,
  G_OBJ_LOAD_TX_RECT: 0xc3,
  G_OBJ_LOAD_TX_RECT_R: 0xc4,
  // S2DEX intercepts the hardware texture-rectangle opcode as HALF_0.
  G_RDPHALF_0: GBIRDPCommands.TextureRectangle,
});
