import { GBI1 } from './gbi1.js';

// L3DEX shares F3DEX's state commands, but B5 is a two-vertex line and
// TRI1/TRI2 draw triangle edges. The low byte of B5 is signed width, not a vertex.
export class GBI1L3DEX extends GBI1 {
  executeLine3D(cmd0, cmd1, dis) {
    this.executeLines(dis, 2, (cmd0, cmd1) => {
      const v0 = (cmd1 >>> 17) & 0x7f;
      const v1 = (cmd1 >>> 9) & 0x7f;
      const width = (cmd1 << 24) >> 24;
      dis?.text(`gsSPLineW3D(${v0}, ${v1}, ${width});`);
      this.pushLine(v0, v1, width, v0);
    });
  }

  executeTri1(cmd0, cmd1, dis) {
    this.executeLines(dis, 6, (cmd0, cmd1) => this.pushEdges(cmd1, dis));
  }

  executeTri2(cmd0, cmd1, dis) {
    this.executeLines(dis, 12, (cmd0, cmd1) => {
      this.pushEdges(cmd0, dis);
      this.pushEdges(cmd1, dis);
    });
  }

  executeLines(dis, capacity, emit) {
    const tb = this.triangleBuffer;
    tb.reset();
    const count = this.state.executeBatch(dis ? 1 : 0, (cmd0, cmd1) => {
      emit(cmd0, cmd1);
      return tb.hasCapacity(capacity);
    });
    this.state.currentOp += count - 1;
    this.renderer.flushTris(tb, { lines: true });
  }

  pushEdges(word, dis) {
    const v0 = (word >>> 17) & 0x7f;
    const v1 = (word >>> 9) & 0x7f;
    const v2 = (word >>> 1) & 0x7f;
    dis?.text(`gsSP1Triangle(${v0}, ${v1}, ${v2}, 0); // wireframe`);
    this.pushLine(v0, v1, 0, v0);
    this.pushLine(v1, v2, 0, v0);
    this.pushLine(v2, v0, 0, v0);
  }

  pushLine(i0, i1, width, flatIndex) {
    if (i0 === i1) return;
    const verts = this.state.projectedVertices;
    if (!verts[i0]?.set || !verts[i1]?.set || (!this.state.geometryMode.shadeSmooth && !verts[flatIndex]?.set)) {
      this.warn('L3DEX line references an unloaded vertex');
      return;
    }
    const flatColor = this.state.geometryMode.shadeSmooth ? null : verts[flatIndex].color;
    const { viWidth, viHeight } = this.renderer.nativeTransform;
    // N64 line width is 1.5 pixels plus a signed half-pixel increment.
    appendLine(this.triangleBuffer, verts[i0], verts[i1], 1.5 + width * 0.5,
      viWidth, viHeight, flatColor);
  }
}

function interpolateVertex(a, b, t) {
  const pos = {};
  for (const key of ['x', 'y', 'z', 'w']) pos[key] = a.pos[key] + (b.pos[key] - a.pos[key]) * t;
  let color = 0;
  for (let shift = 0; shift < 32; shift += 8) {
    const c0 = (a.color >>> shift) & 255;
    const c1 = (b.color >>> shift) & 255;
    color |= Math.round(c0 + (c1 - c0) * t) << shift;
  }
  return { pos, color: color >>> 0, u: 0, v: 0 };
}

// Expand in framebuffer pixels, then return to homogeneous coordinates. This
// keeps width independent of perspective and avoids WebGL's line-width limits.
export function appendLine(tb, a, b, width, viWidth, viHeight, flatColor = null) {
  if (width <= 0 || !tb.hasCapacity(2)) return;
  // Clip depth before dividing by w; the rasterizer clips the expanded sides.
  for (const distance of [p => p.w - 1e-6, p => p.z + p.w, p => p.w - p.z]) {
    const da = distance(a.pos), db = distance(b.pos);
    if (da < 0 && db < 0) return;
    if (da < 0) a = interpolateVertex(a, b, da / (da - db));
    else if (db < 0) b = interpolateVertex(a, b, da / (da - db));
  }
  const dx = (b.pos.x / b.pos.w - a.pos.x / a.pos.w) * viWidth / 2;
  const dy = (b.pos.y / b.pos.w - a.pos.y / a.pos.w) * viHeight / 2;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return;
  const ox = -dy / length * width / viWidth;
  const oy = dx / length * width / viHeight;
  const offset = (v, sign) => ({
    pos: { x: v.pos.x + sign * ox * v.pos.w, y: v.pos.y + sign * oy * v.pos.w, z: v.pos.z, w: v.pos.w },
    color: flatColor ?? v.color, u: 0, v: 0,
  });
  const a0 = offset(a, 1), a1 = offset(a, -1);
  const b0 = offset(b, 1), b1 = offset(b, -1);
  tb.pushTri(a0, a1, b0);
  tb.pushTri(b0, a1, b1);
}
