import { toString32 } from "../format.js";
import * as rdp from "../lle/rdp.js";

const triangle = new rdp.Triangle();

export function disassemble(dv) {
  let t = '';
  if (dv.byteLength < 4) {
    return t;
  }

  triangle.load(dv, 0);
  t += triangle.toString();
  t += '\n';
  
  const commands = [];
  for (let i = 0; i < dv.byteLength; i += 4) {
    commands.push(dv.getUint32(i, false));
  }
  t += commands.toString();
  return t;
}
