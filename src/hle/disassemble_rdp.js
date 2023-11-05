import * as rdp from "../lle/rdp.js";

const triangle = new rdp.Triangle();

export function disassembleCommand(dv, beginAddr, endAddr) {
  const offset = beginAddr;

  let t = '';
  if (offset + 4 > endAddr) {
    return t;
  }

  const cmdType = (dv.getUint32(offset + 0) >> 24) & 63;
  const cmdLen = rdp.CommandLengths[cmdType];
  if (offset + cmdLen > endAddr) {
    return t;
  }

  triangle.load(dv, offset);
  t += triangle.toString();
  return t;
}
