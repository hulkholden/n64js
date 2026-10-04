import { makeEnum } from "../enum.js";

export const RDPCommands = makeEnum({
  Nop: 0,
  FillTriangle: 0x08,
  FillZBufferTriangle: 0x09,
  TextureTriangle: 0x0a,
  TextureZBufferTriangle: 0x0b,
  ShadeTriangle: 0x0c,
  ShadeZBufferTriangle: 0x0d,
  ShadeTextureTriangle: 0x0e,
  ShadeTextureZBufferTriangle: 0x0f,
  TextureRectangle: 0x24,
  TextureRectangleFlip: 0x25,
  SyncLoad: 0x26,
  SyncPipe: 0x27,
  SyncTile: 0x28,
  SyncFull: 0x29,
  SetKeyGB: 0x2a,
  SetKeyR: 0x2b,
  SetConvert: 0x2c,
  SetScissor: 0x2d,
  SetPrimDepth: 0x2e,
  SetOtherModes: 0x2f,
  LoadTLut: 0x30,
  SetTileSize: 0x32,
  LoadBlock: 0x33,
  LoadTile: 0x34,
  SetTile: 0x35,
  FillRectangle: 0x36,
  SetFillColor: 0x37,
  SetFogColor: 0x38,
  SetBlendColor: 0x39,
  SetPrimColor: 0x3a,
  SetEnvColor: 0x3b,
  SetCombine: 0x3c,
  SetTextureImage: 0x3d,
  SetMaskImage: 0x3e,
  SetColorImage: 0x3f,
});

// Display lists encode RDP commands with the top two opcode bits set.
export const GBIRDPCommands = Object.freeze(Object.fromEntries(
  Object.entries(RDPCommands).filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [name, value | 0xc0]),
));
