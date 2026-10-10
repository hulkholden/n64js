import { toString32 } from '../format.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from './gbi_microcode.js';

export function loadObjectSegments(ramDV, address, segments, firstSegment = 0) {
  // Turbo3D reserves segment zero; T3DUX loads all sixteen bases.
  segments[0] = 0;
  for (let i = firstSegment; i < 16; i++) {
    segments[i] = ramDV.getUint32(address + 16 + i * 4);
  }
}

// Shared global state and raw RDP blocks for the object-list microcodes.
export class ObjectMicrocode extends GBIMicrocode {
  loadGlobalState(pointer, dis, firstSegment = 0) {
    const address = this.state.rdpSegmentAddress(pointer);
    const dv = this.ramDV;
    this.executeSetRDPOtherMode(dv.getUint32(address + 8), dv.getUint32(address + 12), dis);
    loadObjectSegments(dv, address, this.state.segments, firstSegment);
    this.loadViewport(address + 80);
    this.processRDP(dv.getUint32(address + 96), dis);
  }

  isRDPEnd(cmd0, cmd1) {
    return cmd0 === 0 && cmd1 === 0;
  }

  processRDP(pointer, dis) {
    if (!pointer) {
      return;
    }
    const dv = this.ramDV;
    let pc = this.state.rdpSegmentAddress(pointer);
    for (;;) {
      const cmd0 = dv.getUint32(pc);
      const cmd1 = dv.getUint32(pc + 4);
      pc += 8;
      // Object RDP blocks have their own terminator, not a GBI SPNoOp.
      if (this.isRDPEnd(cmd0, cmd1)) {
        return;
      }
      const opcode = cmd0 >>> 24;
      if (opcode === gbi.Commands.TextureRectangle || opcode === gbi.Commands.TextureRectangleFlip) {
        // Raw RDP rectangles have one extra 64-bit word, without RDPHalf opcodes.
        const cmd2 = dv.getUint32(pc);
        const cmd3 = dv.getUint32(pc + 4);
        pc += 8;
        this.rdpTexRect(cmd0, cmd1, cmd2, cmd3, dis, opcode === gbi.Commands.TextureRectangleFlip);
      } else {
        const handler = this.getHandler(opcode);
        if (!handler) {
          throw new Error(`Unsupported ${this.constructor.name} RDP command ${toString32(cmd0)}`);
        }
        handler(cmd0, cmd1, dis);
      }
    }
  }
}
