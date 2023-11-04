import { toString32 } from "../format.js";
import * as rdp from "../lle/rdp.js";

const triangle = new rdp.Triangle();

export function disassemble(commands) {
  let t = '';
  if (commands.length < 1) {
    return t;
  }
  const cmdType = (commands[0] >> 24) & 63;

  let offset = 0;
  triangle.loadTriangle(commands, offset);
  offset += 8;

  triangle.loadRGBA(commands, offset);
  offset += 16;

  triangle.loadTexture(commands, offset);
  offset += 16;

  t += `command: ${rdp.Comamnds.nameOf(cmdType)}\n`;
  t += triangle.toString() + '\n';

  commands.forEach((value, index) => {
    t += `${index}: ${toString32(value)}\n`;
  })

  return t;
}