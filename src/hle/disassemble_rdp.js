import { toHex } from "../format.js";
import * as rdp from "../lle/rdp.js";

const triangle = new rdp.Triangle();

const commandTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(disassembleUnknown);
  }

  tbl[rdp.Commands.Nop] = disassembleNop;
  tbl[rdp.Commands.FillTriangle] = disassembleTriangle;
  tbl[rdp.Commands.FillZBufferTriangle] = disassembleTriangle;
  tbl[rdp.Commands.TextureTriangle] = disassembleTriangle;
  tbl[rdp.Commands.TextureZBufferTriangle] = disassembleTriangle;
  tbl[rdp.Commands.ShadeTriangle] = disassembleTriangle;
  tbl[rdp.Commands.ShadeZBufferTriangle] = disassembleTriangle;
  tbl[rdp.Commands.ShadeTextureTriangle] = disassembleTriangle;
  tbl[rdp.Commands.ShadeTextureZBufferTriangle] = disassembleTriangle;
  tbl[rdp.Commands.TextureRectangle] = disassembleUnhandled;
  tbl[rdp.Commands.TextureRectangleFlip] = disassembleUnhandled;
  tbl[rdp.Commands.SyncLoad] = disassembleUnhandled;
  tbl[rdp.Commands.SyncPipe] = disassembleUnhandled;
  tbl[rdp.Commands.SyncTile] = disassembleUnhandled;
  tbl[rdp.Commands.SyncFull] = disassembleUnhandled;
  tbl[rdp.Commands.SetKeyGB] = disassembleUnhandled;
  tbl[rdp.Commands.SetKeyR] = disassembleUnhandled;
  tbl[rdp.Commands.SetConvert] = disassembleUnhandled;
  tbl[rdp.Commands.SetScissor] = disassembleUnhandled;
  tbl[rdp.Commands.SetPrimDepth] = disassembleUnhandled;
  tbl[rdp.Commands.SetOtherModes] = disassembleUnhandled;
  tbl[rdp.Commands.LoadTLut] = disassembleUnhandled;
  tbl[rdp.Commands.SetTileSize] = disassembleUnhandled;
  tbl[rdp.Commands.LoadBlock] = disassembleUnhandled;
  tbl[rdp.Commands.LoadTile] = disassembleUnhandled;
  tbl[rdp.Commands.SetTile] = disassembleUnhandled;
  tbl[rdp.Commands.FillRectangle] = disassembleUnhandled;
  tbl[rdp.Commands.SetFillColor] = disassembleUnhandled;
  tbl[rdp.Commands.SetFogColor] = disassembleUnhandled;
  tbl[rdp.Commands.SetBlendColor] = disassembleUnhandled;
  tbl[rdp.Commands.SetPrimColor] = disassembleUnhandled;
  tbl[rdp.Commands.SetEnvColor] = disassembleUnhandled;
  tbl[rdp.Commands.SetCombine] = disassembleUnhandled;
  tbl[rdp.Commands.SetTextureImage] = disassembleUnhandled;
  tbl[rdp.Commands.SetMaskImage] = disassembleUnhandled;
  tbl[rdp.Commands.SetColorImage] = disassembleUnhandled;

  return tbl;
})();

function commandBytes(cmdType, dv, offset) {
  let t = [];
  const len = rdp.CommandLengths[cmdType] * 8;
  for (let i = 0; i < len; i += 8) {
    t.push(toHex(dv.getBigUint64(offset + i, false), 64));
  }
  return t.join(' ');
}

function disassembleUnknown(cmdType, dv, offset) {
  return 'Unknown';
}

function disassembleUnhandled(cmdType, dv, offset) {
  return ''
}

function disassembleNop(cmdType, dv, offset) {
  return '';
}

function disassembleTriangle(cmdType, dv, offset) {
  triangle.load(dv, offset);
  return '\n' + triangle.toString();
}

function padString(t, len) {
  while (t.length < len) {
    t += ' ';
  }
  return t;
}

export function disassembleCommand(dv, beginAddr, endAddr) {
  const offset = beginAddr;
  if (offset + 4 > endAddr) {
    return null;
  }

  const cmd = dv.getUint32(offset, false);
  const cmdType = (cmd >> 24) & 63;
  const cmdLen = rdp.CommandLengths[cmdType] * 8;
  if (offset + cmdLen > endAddr) {
    return null;
  }

  const name = padString(rdp.Commands.nameOf(cmdType), 24);
  let disassembly = `${name}${commandBytes(cmdType, dv, offset)}`;
  disassembly += commandTable[cmdType](cmdType, dv, offset);
  return {
    address: beginAddr,
    disassembly: disassembly,
  };
}

export function disassembleRange(dv, beginAddr, endAddr, addrMask) {
  const disassembly = [];
  let addr = beginAddr;
  while (addr < endAddr) {
    const cmd = dv.getUint32(addr & addrMask, false);
    const cmdType = (cmd >> 24) & 63;
    const cmdLen = rdp.CommandLengths[cmdType] * 8;
    const d = disassembleCommand(dv, addr, endAddr);
    disassembly.push(d);
    addr += cmdLen;
  }
  return disassembly;
}
