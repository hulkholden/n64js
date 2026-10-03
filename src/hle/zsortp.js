import { toString32 } from '../format.js';
import * as gbi from './gbi.js';
import { GBIMicrocode } from './gbi_microcode.js';
import { GBI1 } from './gbi1.js';
import { ProjectedVertex } from './projected_vertex.js';

const G_SPNOOP = 0x00;
const G_ZS_ZOBJ = 0x80;
const G_ZS_RDPCMD = 0x81;
const G_MOVEWORD = 0xdb;
const G_DL = 0xde;
const G_ENDDL = 0xdf;
const G_SETOTHERMODE_L = 0xe2;
const G_SETOTHERMODE_H = 0xe3;
const G_TEXRECT = 0xe4;
const G_TEXRECTFLIP = 0xe5;

const OBJECT_TYPE_NULL = 0;
const OBJECT_TYPE_SHADED_TRIANGLE = 1;
const OBJECT_TYPE_TEXTURED_TRIANGLE = 2;
const OBJECT_TYPE_SHADED_QUAD = 3;
const OBJECT_TYPE_TEXTURED_QUAD = 4;
const OBJECT_TYPE_MASK = 0x07;

const SHADED_VERTEX_BYTES = 8;
const TEXTURED_VERTEX_BYTES = 16;

const SCREEN_XY_SCALE = 4;
const TEXCOORD_SCALE = 32;
const INV_W_NUMERATOR = 0x7fffffff;
const CLIP_W_SCALE = 31;

// Host execution safeguards, not hardware limits.
const MAX_RDP_COMMANDS = 100_000;
const MAX_OBJECTS = 100_000;

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
      [G_SPNOOP, this.executeSpNoop.bind(this)],
      [G_ZS_ZOBJ, this.executeObjects.bind(this)],
      [G_ZS_RDPCMD, this.executeRDPList.bind(this)],

      // These commands retain the original GBI1 field encodings, despite
      // occupying opcode slots also used by GBI2.
      [G_MOVEWORD, this.executeMoveWord.bind(this)],
      [G_DL, GBI1.prototype.executeDL.bind(this)],
      [G_ENDDL, GBI1.prototype.executeEndDL.bind(this)],
      [G_SETOTHERMODE_L, GBI1.prototype.executeSetOtherModeL.bind(this)],
      [G_SETOTHERMODE_H, GBI1.prototype.executeSetOtherModeH.bind(this)],
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
    if (!pointer) {
      return;
    }

    const dv = this.ramDV;
    let pc = this.state.rdpSegmentAddress(pointer);

    for (let count = 0; count < MAX_RDP_COMMANDS; count++) {
      const cmd0 = dv.getUint32(pc);
      const cmd1 = dv.getUint32(pc + 4);
      const opcode = cmd0 >>> 24;
      pc += 8;

      if (opcode === G_ENDDL) {
        return;
      }

      if (opcode === G_TEXRECT || opcode === G_TEXRECTFLIP) {
        const cmd2 = dv.getUint32(pc + 4);
        const cmd3 = dv.getUint32(pc + 12);
        pc += 16;

        if (opcode === G_TEXRECT) {
          this.rdpTexRect(cmd0, cmd1, cmd2, cmd3, dis);
        } else {
          this.rdpTexRectFlip(cmd0, cmd1, cmd2, cmd3, dis);
        }
      } else {
        // OtherMode and NoOp use their GBI encodings inside these blocks too.
        // Do not dispatch nested object/task commands from an RDP block.
        const handler = opcode === G_SPNOOP || opcode === G_SETOTHERMODE_L || opcode === G_SETOTHERMODE_H
          ? this.commands.get(opcode) : this.gbiCommonCommands.get(opcode);
        if (!handler) {
          this.executeUnknown(cmd0, cmd1);
        }

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
        if (++count > MAX_OBJECTS) {
          throw new Error('ZSortp object list limit exceeded');
        }

        // Low three pointer bits identify the object type. Quads are triangle strips.
        const type = header & OBJECT_TYPE_MASK;
        const address = header & ~OBJECT_TYPE_MASK;
        if (type > OBJECT_TYPE_TEXTURED_QUAD) {
          throw new Error(`Invalid ZSortp object type ${type}`);
        }

        const textured = type === OBJECT_TYPE_TEXTURED_TRIANGLE || type === OBJECT_TYPE_TEXTURED_QUAD;
        const shaded = type === OBJECT_TYPE_SHADED_TRIANGLE || type === OBJECT_TYPE_SHADED_QUAD;
        const quad = type === OBJECT_TYPE_SHADED_QUAD || type === OBJECT_TYPE_TEXTURED_QUAD;
        const lists = shaded ? 1 : 3;

        for (let i = 0; i < lists; i++) {
          const next = dv.getUint32(address + 4 + i * 4);
          if (next !== rdpLists[i]) {
            this.processRDP(next, dis);
            rdpLists[i] = next;
          }
        }

        if (type !== OBJECT_TYPE_NULL) {
          this.drawObject(address + 4 + lists * 4, quad ? 4 : 3, textured);
        }

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

    const vertexBytes = textured ? TEXTURED_VERTEX_BYTES : SHADED_VERTEX_BYTES;
    for (let i = 0; i < count; i++, address += vertexBytes) {
      const vertex = this.vertices[i];
      const x = dv.getInt16(address) / SCREEN_XY_SCALE;
      const y = dv.getInt16(address + 2) / SCREEN_XY_SCALE;
      const invW = textured ? dv.getInt32(address + 12) : 0;

      // ZSort stores 0x7fffffff / (31 * clipW). Restore clip coordinates for
      // perspective interpolation, while retaining the supplied screen X/Y.
      const w = textured && (state.rdpOtherModeH & gbi.G_TP_MASK)
        ? (invW === 0 ? INV_W_NUMERATOR : Math.trunc(INV_W_NUMERATOR / invW)) / CLIP_W_SCALE : 1;
      vertex.pos.set((2 * x / vi.viWidth - 1) * w, (1 - 2 * y / vi.viHeight) * w, 0, w);
      vertex.color = dv.getUint32(address + 4, true);

      // flushTris applies the extra factor of 1/2 when perspective is off.
      vertex.u = textured ? dv.getInt16(address + 8) / TEXCOORD_SCALE : 0;
      vertex.v = textured ? dv.getInt16(address + 10) / TEXCOORD_SCALE : 0;
    }

    const [a, b, c, d] = this.vertices;
    const tb = this.triangleBuffer;
    tb.reset();
    tb.pushTri(a, b, c);
    if (count === 4) {
      tb.pushTri(c, b, d);
    }

    this.renderer.flushTris(tb);
  }
}
