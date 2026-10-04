import { toHex } from "../format.js";
import * as rdp from "../lle/rdp.js";
import { RDPCommands } from "../lle/rdp_commands.js";

const triangle = new rdp.Triangle();

const commandTable = (() => {
  let tbl = [];
  for (let i = 0; i < 64; i++) {
    tbl.push(disassembleUnknown);
  }

  tbl[RDPCommands.Nop] = disassembleNop;
  tbl[RDPCommands.FillTriangle] = disassembleTriangle;
  tbl[RDPCommands.FillZBufferTriangle] = disassembleTriangle;
  tbl[RDPCommands.TextureTriangle] = disassembleTriangle;
  tbl[RDPCommands.TextureZBufferTriangle] = disassembleTriangle;
  tbl[RDPCommands.ShadeTriangle] = disassembleTriangle;
  tbl[RDPCommands.ShadeZBufferTriangle] = disassembleTriangle;
  tbl[RDPCommands.ShadeTextureTriangle] = disassembleTriangle;
  tbl[RDPCommands.ShadeTextureZBufferTriangle] = disassembleTriangle;
  tbl[RDPCommands.TextureRectangle] = disassembleUnhandled;
  tbl[RDPCommands.TextureRectangleFlip] = disassembleUnhandled;
  tbl[RDPCommands.SyncLoad] = disassembleUnhandled;
  tbl[RDPCommands.SyncPipe] = disassembleUnhandled;
  tbl[RDPCommands.SyncTile] = disassembleUnhandled;
  tbl[RDPCommands.SyncFull] = disassembleUnhandled;
  tbl[RDPCommands.SetKeyGB] = disassembleUnhandled;
  tbl[RDPCommands.SetKeyR] = disassembleUnhandled;
  tbl[RDPCommands.SetConvert] = disassembleUnhandled;
  tbl[RDPCommands.SetScissor] = disassembleUnhandled;
  tbl[RDPCommands.SetPrimDepth] = disassembleUnhandled;
  tbl[RDPCommands.SetOtherModes] = disassembleUnhandled;
  tbl[RDPCommands.LoadTLut] = disassembleUnhandled;
  tbl[RDPCommands.SetTileSize] = disassembleUnhandled;
  tbl[RDPCommands.LoadBlock] = disassembleUnhandled;
  tbl[RDPCommands.LoadTile] = disassembleUnhandled;
  tbl[RDPCommands.SetTile] = disassembleUnhandled;
  tbl[RDPCommands.FillRectangle] = disassembleUnhandled;
  tbl[RDPCommands.SetFillColor] = disassembleUnhandled;
  tbl[RDPCommands.SetFogColor] = disassembleUnhandled;
  tbl[RDPCommands.SetBlendColor] = disassembleUnhandled;
  tbl[RDPCommands.SetPrimColor] = disassembleUnhandled;
  tbl[RDPCommands.SetEnvColor] = disassembleUnhandled;
  tbl[RDPCommands.SetCombine] = disassembleUnhandled;
  tbl[RDPCommands.SetTextureImage] = disassembleUnhandled;
  tbl[RDPCommands.SetMaskImage] = disassembleUnhandled;
  tbl[RDPCommands.SetColorImage] = disassembleUnhandled;

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

  const name = padString(RDPCommands.nameOf(cmdType), 24);
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
