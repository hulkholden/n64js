import { toString32 } from "../format.js";
import * as rdp from "../lle/rdp.js";

const triangle = new rdp.Triangle();

export function disassemble(commands) {
  let t = '';
  if (commands.length < 1) {
    return t;
  }

  triangle.load(commands, 0);
  t += triangle.toString();
  t += '\n';
  t += commands.toString();
  return t;
}
