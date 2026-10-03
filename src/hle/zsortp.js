import { toString32 } from '../format.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { GBI1 } from './gbi1.js';
import { ProjectedVertex } from './projected_vertex.js';

// Nintendo ZSortp uses linked, already sorted screen-space objects. It is
// unrelated to BOSS ZSort. RDP blocks end with ENDDL and contain GBI-style
// RDPHalf words after texture rectangles.
// Layouts: SDK PR/gzsort.h; rendering reference:
// https://github.com/gonetz/GLideN64/blob/master/src/uCodes/ZSort.cpp
// The soccer family submits CPU-transformed objects. The optional DMEM math,
// lighting and CPU/RSP signal commands still fail explicitly if encountered.
export class ZSortP extends GBIMicrocode {
  constructor(state, ramDV) {
    super(state, ramDV);
    this.vertices = Array.from({ length: 4 }, () => new ProjectedVertex());
    this.commands = new Map([
      [0x00, this.executeSpNoop.bind(this)],
      [0x80, this.executeObjects.bind(this)],
      [0x81, this.executeRDPList.bind(this)],
      // These commands retain the original GBI1 field encodings, despite
      // occupying opcode slots also used by GBI2.
      [0xdb, this.executeMoveWord.bind(this)],
      [0xde, GBI1.prototype.executeDL.bind(this)],
      [0xdf, GBI1.prototype.executeEndDL.bind(this)],
      [0xe2, GBI1.prototype.executeSetOtherModeL.bind(this)],
      [0xe3, GBI1.prototype.executeSetOtherModeH.bind(this)],
    ]);
  }

  getHandler(command) {
    return this.commands.get(command) || super.getHandler(command);
  }

  executeUnknown(cmd0, cmd1) {
    // Do not silently skip the optional DMEM computation/signal protocol.
    throw new Error(`Unsupported ZSortp command ${toString32(cmd0)}, ${toString32(cmd1)}`);
  }

  executeMoveWord(cmd0, cmd1, dis) {
    const type = cmd0 & 0xff;
    if (type !== gbi.MoveWord.G_MW_SEGMENT && type !== gbi.MoveWord.G_MW_PERSPNORM) {
      this.executeUnknown(cmd0, cmd1);
    }
    GBI1.prototype.executeMoveWord.call(this, cmd0, cmd1, dis);
  }

  executeRDPList(cmd0, cmd1, dis) {
    dis?.text(`gsSPZRdpCmd(${toString32(cmd1)});`);
    this.processRDP(cmd1, dis);
  }

  processRDP(pointer, dis) {
    if (!pointer) return;
    const dv = this.ramDV;
    let pc = this.state.rdpSegmentAddress(pointer);
    for (let count = 0; count < 100_000; count++) {
      const cmd0 = dv.getUint32(pc);
      const cmd1 = dv.getUint32(pc + 4);
      const opcode = cmd0 >>> 24;
      pc += 8;
      if (opcode === 0xdf) return;
      if (opcode === 0xe4 || opcode === 0xe5) {
        const cmd2 = dv.getUint32(pc + 4);
        const cmd3 = dv.getUint32(pc + 12);
        pc += 16;
        if (opcode === 0xe4) this.rdpTexRect(cmd0, cmd1, cmd2, cmd3, dis);
        else this.rdpTexRectFlip(cmd0, cmd1, cmd2, cmd3, dis);
      } else {
        // OtherMode and NoOp use their GBI encodings inside these blocks too.
        // Do not dispatch nested object/task commands from an RDP block.
        const handler = opcode === 0 || opcode === 0xe2 || opcode === 0xe3
          ? this.commands.get(opcode) : this.gbiCommonCommands.get(opcode);
        if (!handler) this.executeUnknown(cmd0, cmd1);
        handler(cmd0, cmd1, dis);
      }
    }
    throw new Error('ZSortp RDP list command limit exceeded');
  }

  executeObjects(cmd0, cmd1, dis) {
    dis?.text(`gsSPZObject(${toString32(cmd0)}, ${toString32(cmd1)});`);
    const state = this.state;
    const dv = this.ramDV;
    const rdpLists = [0, 0, 0];
    let count = 0;
    for (const pointer of [cmd0, cmd1]) {
      let header = state.rdpSegmentAddress(pointer);
      while (header) {
        if (++count > 100_000) throw new Error('ZSortp object list limit exceeded');
        // Low three pointer bits: null, shaded triangle, textured triangle,
        // shaded quad, textured quad. Quads are triangle strips.
        const type = header & 7;
        const address = header & ~7;
        if (type > 4) throw new Error(`Invalid ZSortp object type ${type}`);
        const textured = type === 2 || type === 4;
        const lists = type === 1 || type === 3 ? 1 : 3;
        for (let i = 0; i < lists; i++) {
          const next = dv.getUint32(address + 4 + i * 4);
          if (next !== rdpLists[i]) {
            this.processRDP(next, dis);
            rdpLists[i] = next;
          }
        }
        if (type) this.drawObject(address + 4 + lists * 4, type >= 3 ? 4 : 3, textured);
        header = state.rdpSegmentAddress(dv.getUint32(address));
      }
    }
  }

  drawObject(address, count, textured) {
    const state = this.state;
    const dv = this.ramDV;
    const vi = this.renderer.nativeTransform;
    state.setTexture(1, 1, 0, 0);
    Object.assign(state.geometryMode, { texture: textured ? 1 : 0, shade: 1, shadeSmooth: 1,
      cullFront: 0, cullBack: 0, lighting: 0, zbuffer: 0, fog: 0 });
    for (let i = 0; i < count; i++, address += textured ? 16 : 8) {
      const vertex = this.vertices[i];
      const x = dv.getInt16(address) / 4;
      const y = dv.getInt16(address + 2) / 4;
      const invW = textured ? dv.getInt32(address + 12) : 0;
      // ZSort stores 0x7fffffff / (31 * clipW). Restore clip coordinates for
      // perspective interpolation, while retaining the supplied screen X/Y.
      const w = textured && (state.rdpOtherModeH & gbi.G_TP_MASK)
        ? (invW === 0 ? 0x7fffffff : Math.trunc(0x7fffffff / invW)) / 31 : 1;
      vertex.pos.set((2 * x / vi.viWidth - 1) * w, (1 - 2 * y / vi.viHeight) * w, 0, w);
      vertex.color = dv.getUint32(address + 4, true);
      // flushTris applies the extra factor of 1/2 when perspective is off.
      vertex.u = textured ? dv.getInt16(address + 8) / 32 : 0;
      vertex.v = textured ? dv.getInt16(address + 10) / 32 : 0;
    }
    const [a, b, c, d] = this.vertices;
    const tb = this.triangleBuffer;
    tb.reset();
    tb.pushTri(a, b, c);
    if (count === 4) tb.pushTri(c, b, d);
    this.renderer.flushTris(tb);
  }
}
