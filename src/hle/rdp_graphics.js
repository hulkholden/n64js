import { GBIMicrocode } from './gbi_microcode.js';
import { ProjectedVertex } from './projected_vertex.js';
import { Commands, Triangle } from '../lle/rdp.js';
import * as gbi from './gbi.js';

const GBI_RDP_COMMAND_PREFIX = 0xc0;
const IMAGE_ADDRESS_MASK = 0x03ffffff;
const IMAGE_FORMAT_SHIFT = 21;
const IMAGE_FORMAT_MASK = 7;
const IMAGE_SIZE_SHIFT = 19;
const IMAGE_SIZE_MASK = 3;
const IMAGE_WIDTH_MASK = 0xfff;
const MIP_LEVEL_SHIFT = 19;
const MIP_LEVEL_MASK = 7;

const EDGE_X_FRAC_BITS = 16;
const EDGE_Y_FRAC_BITS = 2;
const ATTRIBUTE_FRAC_BITS = 16;
const TEXCOORD_FRAC_BITS = 5;
const INV_W_FRAC_BITS = 15;
const DEPTH_FRAC_BITS = 31;
const MIN_INV_W = fromFixed(1, INV_W_FRAC_BITS);
// flushTris halves non-perspective RSP UVs; raw RDP UVs need no halving.
const AFFINE_UV_COMPENSATION = 2;

const STW_S = 0;
const STW_T = 1;
const STW_W = 2;
const COLOR_CHANNELS = 4;
const COLOR_CHANNEL_BITS = 8;
const COLOR_CHANNEL_MAX = (1 << COLOR_CHANNEL_BITS) - 1;
const OPAQUE_WHITE = 0xffffffff;

// Values are already sign-extended by the packet decoder. Preserve fractional
// results from interpolation; bitwise shifts would truncate and wrap them.
function fromFixed(value, fractionalBits) {
  return value / (2 ** fractionalBits);
}

function edgeXAtY(baseX, slope, baseY, y) {
  return fromFixed(baseX + (y - baseY) * slope, EDGE_X_FRAC_BITS);
}

function interpolate(base, de, dx, offsetX, offsetY) {
  return base + de * offsetY + dx * offsetX;
}

function sampleAttribute(base, de, dx, channel, offsetX, offsetY) {
  return fromFixed(interpolate(base.elems[channel], de.elems[channel], dx.elems[channel], offsetX, offsetY), ATTRIBUTE_FRAC_BITS);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sampleDepth(data, offsetX, offsetY) {
  const base = data.getU32(0) | 0;
  const dx = data.getU32(4) | 0;
  const de = data.getU32(8) | 0;
  const depth = fromFixed(interpolate(base, de, dx, offsetX, offsetY), DEPTH_FRAC_BITS);
  return clamp(depth * 2 - 1, -1, 1);
}

function sampleShadeColor(tri, offsetX, offsetY) {
  let color = 0;
  for (let channel = 0; channel < COLOR_CHANNELS; channel++) {
    const value = sampleAttribute(tri.rgba, tri.drgba_de, tri.drgba_dx, channel, offsetX, offsetY);
    color |= Math.trunc(clamp(value, 0, COLOR_CHANNEL_MAX)) << (COLOR_CHANNEL_BITS * channel);
  }
  return color >>> 0;
}

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
    if (type >= Commands.FillTriangle && type <= Commands.ShadeTextureZBufferTriangle) {
      this.drawTriangle(buffer);
    } else if (type === Commands.TextureRectangle || type === Commands.TextureRectangleFlip) {
      const fn = type === Commands.TextureRectangle ? this.rdpTexRect : this.rdpTexRectFlip;
      fn.call(this, cmd0, cmd1, buffer.getU32(8), buffer.getU32(12));
    } else if (type >= Commands.SetTextureImage) {
      const address = cmd1 & IMAGE_ADDRESS_MASK;
      if (type === Commands.SetMaskImage) {
        this.state.depthImage.address = address;
      } else {
        const format = (cmd0 >>> IMAGE_FORMAT_SHIFT) & IMAGE_FORMAT_MASK;
        const size = (cmd0 >>> IMAGE_SIZE_SHIFT) & IMAGE_SIZE_MASK;
        const width = (cmd0 & IMAGE_WIDTH_MASK) + 1;
        if (type === Commands.SetTextureImage) {
          this.setTextureImage(format, size, width, address);
        } else {
          this.state.colorImage = { format, size, width, address };
          this.renderer.setColorImage?.(this.state.colorImage);
        }
      }
    } else {
      const handler = this.gbiCommonCommands.get(type | GBI_RDP_COMMAND_PREFIX);
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
    const mipLevel = (buffer.getU32(0) >>> MIP_LEVEL_SHIFT) & MIP_LEVEL_MASK;
    state.setTexture(1, 1, mipLevel, tri.tile);
    Object.assign(state.geometryMode, { texture: tri.texture ? 1 : 0, shade: 1, shadeSmooth: 1,
      cullFront: 0, cullBack: 0, lighting: 0, textureGen: 0, zbuffer: tri.zbuffer ? 1 : 0, fog: 0 });
    const perspective = tri.texture && (state.rdpOtherModeH & gbi.G_TP_MASK) !== 0;
    const yh = fromFixed(tri.yh, EDGE_Y_FRAC_BITS);
    const ym = fromFixed(tri.ym, EDGE_Y_FRAC_BITS);
    const yl = fromFixed(tri.yl, EDGE_Y_FRAC_BITS);
    const yBase = Math.floor(yh);
    const majorX = y => edgeXAtY(tri.xh, tri.dxhdy, yBase, y);
    const tb = this.triangleBuffer;
    tb.reset();

    const vertex = (index, x, y) => {
      const v = this.vertices[index];
      const offsetX = x - Math.floor(majorX(y));
      const offsetY = y - yBase;
      let w = 1;
      if (tri.texture) {
        const s = sampleAttribute(tri.stw, tri.dstw_de, tri.dstw_dx, STW_S, offsetX, offsetY);
        const t = sampleAttribute(tri.stw, tri.dstw_de, tri.dstw_dx, STW_T, offsetX, offsetY);
        // RDP W is normalized inverse depth (s.15), S/T are s10.5.
        const rawInvW = sampleAttribute(tri.stw, tri.dstw_de, tri.dstw_dx, STW_W, offsetX, offsetY);
        const invW = fromFixed(rawInvW, INV_W_FRAC_BITS);
        w = perspective ? 1 / Math.max(invW, MIN_INV_W) : 1;
        const scale = fromFixed(perspective ? w : AFFINE_UV_COMPENSATION, TEXCOORD_FRAC_BITS);
        v.u = s * scale;
        v.v = t * scale;
      }
      const z = tri.zbuffer ? sampleDepth(data, offsetX, offsetY) : 0;
      const vi = this.renderer.nativeTransform;
      v.pos.set((2 * x / vi.viWidth - 1) * w, (1 - 2 * y / vi.viHeight) * w, z * w, w);
      v.color = tri.shade ? sampleShadeColor(tri, offsetX, offsetY) : OPAQUE_WHITE;
      return v;
    };

    for (const [top, bottom, baseX, slope, baseY] of [
      [yh, ym, tri.xm, tri.dxmdy, yBase],
      [ym, yl, tri.xl, tri.dxldy, ym],
    ]) {
      if (bottom <= top) {
        continue;
      }
      const a = vertex(0, majorX(top), top);
      const b = vertex(1, edgeXAtY(baseX, slope, baseY, top), top);
      const c = vertex(2, majorX(bottom), bottom);
      const d = vertex(3, edgeXAtY(baseX, slope, baseY, bottom), bottom);
      tb.pushTri(a, b, c);
      tb.pushTri(c, b, d);
    }
    this.renderer.flushTris(tb);
  }
}
