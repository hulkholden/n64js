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

function commandBytes(cmdType, buf) {
  let t = [];
  const len = rdp.CommandLengths[cmdType] * 8;
  for (let i = 0; i < len; i += 8) {
    t.push(toHex(buf.getU64(i), 64));
  }
  return t.join(' ');
}

function disassembleUnknown(cmdType, buf) {
  return 'Unknown';
}

function disassembleUnhandled(cmdType, buf) {
  return ''
}

function disassembleNop(cmdType, buf) {
  return '';
}

function disassembleTriangle(cmdType, buf) {
  triangle.load(buf);
  return '\n' + triangle.toString();
}

function padString(t, len) {
  while (t.length < len) {
    t += ' ';
  }
  return t;
}

export function disassembleCommand(buf) {
  buf = buf.clone();

  if (buf.bytesRemaining() < 4) {
    return null;
  }

  const beginAddr = buf.curAddr;
  const cmd = buf.getU32(0);
  const cmdType = (cmd >> 24) & 63;
  const cmdLen = rdp.CommandLengths[cmdType] * 8;
  if (buf.bytesRemaining() < cmdLen) {
    return null;
  }

  const name = padString(rdp.Commands.nameOf(cmdType), 24);
  let disassembly = `${name}${commandBytes(cmdType, buf)}`;
  disassembly += commandTable[cmdType](cmdType, buf);
  return {
    address: beginAddr,
    disassembly: disassembly,
  };
}

export function disassembleRange(buf) {
  buf = buf.clone();

  const disassembly = [];
  while (!buf.empty()) {
    const cmd = buf.getU32(0);
    const cmdType = (cmd >> 24) & 63;
    const cmdLen = rdp.CommandLengths[cmdType] * 8;

    const d = disassembleCommand(buf);
    if (d != null) {
      disassembly.push(d);
    }

    buf.advance(cmdLen);
  }
  return disassembly;
}
