import { GBIMicrocode } from './gbi_microcode.js';
import { ProjectedVertex } from './projected_vertex.js';
import { Triangle } from '../lle/rdp.js';
import * as gbi from './gbi.js';

// Rasterize the RSP's output through the same WebGL/TMEM implementation as HLE.
// These are hardware RDP packets: addresses are physical and texture rectangles
// contain four consecutive words (there are no GBI RDPHalf wrapper commands).
export class RDPGraphics extends GBIMicrocode {
  constructor(state, ramDV, renderer) {
    super(state, ramDV);
    this.renderer = renderer;
    this.triangle = new Triangle();
    this.vertices = Array.from({ length: 4 }, () => new ProjectedVertex());
  }

  execute(type, buffer) {
    const cmd0 = buffer.getU32(0);
    const cmd1 = buffer.getU32(4);
    if (type >= 0x08 && type <= 0x0f) {
      this.drawTriangle(buffer);
    } else if (type === 0x24 || type === 0x25) {
      const fn = type === 0x24 ? this.rdpTexRect : this.rdpTexRectFlip;
      fn.call(this, cmd0, cmd1, buffer.getU32(8), buffer.getU32(12));
    } else if (type >= 0x3d) {
      const address = cmd1 & 0x03ffffff;
      if (type === 0x3e) {
        this.state.depthImage.address = address;
      } else {
        const format = (cmd0 >>> 21) & 7;
        const size = (cmd0 >>> 19) & 3;
        const width = (cmd0 & 0xfff) + 1;
        if (type === 0x3d) {
          this.setTextureImage(format, size, width, address);
        } else {
          this.state.colorImage = { format, size, width, address };
          this.renderer.setColorImage?.(this.state.colorImage);
        }
      }
    } else {
      const handler = this.gbiCommonCommands.get(type | 0xc0);
      if (!handler) {
        throw new Error(`Unsupported RDP command 0x${type.toString(16)}`);
      }
      handler(cmd0, cmd1);
    }
  }

  // The edge/attribute coefficient layout is specified in the SGI RDP Command
  // Summary, pp. 12–20: https://hcs64.com/files/RDP_COMMANDS.pdf
  // Split at YM to retain both minor edges, including flat-top/bottom triangles.
  // This uses the existing polygon renderer, not a cycle/coverage-accurate RDP.
  drawTriangle(buffer) {
    const tri = this.triangle;
    const data = buffer.clone();
    tri.load(data);
    const state = this.state;
    state.setTexture(1, 1, (buffer.getU32(0) >>> 19) & 7, tri.tile);
    Object.assign(state.geometryMode, { texture: tri.texture ? 1 : 0, shade: 1, shadeSmooth: 1,
      cullFront: 0, cullBack: 0, lighting: 0, textureGen: 0, zbuffer: tri.zbuffer ? 1 : 0, fog: 0 });
    const perspective = tri.texture && (state.rdpOtherModeH & gbi.G_TP_MASK) !== 0;
    const yBase = Math.floor(tri.yh / 4);
    const majorX = y => (tri.xh + (y - yBase) * tri.dxhdy) / 65536;
    const tb = this.triangleBuffer;
    tb.reset();

    const sample = (base, de, dx, channel, x, y) =>
      (base.elems[channel] + de.elems[channel] * (y - yBase)
        + dx.elems[channel] * (x - Math.floor(majorX(y)))) / 65536;
    const vertex = (index, x, y) => {
      const v = this.vertices[index];
      let w = 1;
      if (tri.texture) {
        const s = sample(tri.stw, tri.dstw_de, tri.dstw_dx, 0, x, y);
        const t = sample(tri.stw, tri.dstw_de, tri.dstw_dx, 1, x, y);
        // RDP W is normalized inverse depth (s.15), S/T are s10.5.
        const invW = sample(tri.stw, tri.dstw_de, tri.dstw_dx, 2, x, y) / 32768;
        w = perspective ? 1 / Math.max(invW, 1 / 32768) : 1;
        // flushTris halves non-perspective RSP UVs; raw RDP UVs need no halving.
        const scale = perspective ? w / 32 : 1 / 16;
        v.u = s * scale;
        v.v = t * scale;
      }
      let z = 0;
      if (tri.zbuffer) {
        z = ((data.getU32(0) | 0) + (data.getU32(8) | 0) * (y - yBase)
          + (data.getU32(4) | 0) * (x - Math.floor(majorX(y)))) / 0x80000000;
        z = Math.max(-1, Math.min(1, z * 2 - 1));
      }
      const vi = this.renderer.nativeTransform;
      v.pos.set((2 * x / vi.viWidth - 1) * w, (1 - 2 * y / vi.viHeight) * w, z * w, w);
      v.color = 0xffffffff;
      if (tri.shade) {
        let color = 0;
        for (let c = 0; c < 4; c++) {
          const value = Math.max(0, Math.min(255, sample(tri.rgba, tri.drgba_de, tri.drgba_dx, c, x, y)));
          color |= Math.trunc(value) << (8 * c);
        }
        v.color = color >>> 0;
      }
      return v;
    };

    for (const [top, bottom, baseX, slope, baseY] of [
      [tri.yh / 4, tri.ym / 4, tri.xm, tri.dxmdy, yBase],
      [tri.ym / 4, tri.yl / 4, tri.xl, tri.dxldy, tri.ym / 4],
    ]) {
      if (bottom <= top) {
        continue;
      }
      const a = vertex(0, majorX(top), top);
      const b = vertex(1, (baseX + (top - baseY) * slope) / 65536, top);
      const c = vertex(2, majorX(bottom), bottom);
      const d = vertex(3, (baseX + (bottom - baseY) * slope) / 65536, bottom);
      tb.pushTri(a, b, c);
      tb.pushTri(c, b, d);
    }
    this.renderer.flushTris(tb, { screenSpaceShade: true });
  }
}
