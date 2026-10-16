import { GBI1 } from './gbi1.js';
import { GBI2 } from './gbi2.js';

function lineMicrocode(Base) {
  return class extends Base {
    executeLines(dis, capacity, emit) {
      const tb = this.triangleBuffer;
      tb.reset();
      // Bound commands too: clipped/degenerate lines consume no buffer capacity.
      const count = this.state.executeBatch(dis ? 1 : Math.floor(tb.maxTris / capacity), (cmd0, cmd1) => {
        emit(cmd0, cmd1);
        return tb.hasCapacity(capacity);
      });
      this.state.currentOp += count - 1;
      this.renderer.flushTris(tb, { lines: true });
    }

    pushEdges(word, dis, width = 0) {
      const v0 = (word >>> 17) & 0x7f;
      const v1 = (word >>> 9) & 0x7f;
      const v2 = (word >>> 1) & 0x7f;
      dis?.text(`gsSP1Triangle(${v0}, ${v1}, ${v2}, 0); // wireframe, width ${width}`);
      this.pushLine(v0, v1, width, v0);
      this.pushLine(v1, v2, width, v0);
      this.pushLine(v2, v0, width, v0);
    }

    pushLine(i0, i1, width, flatIndex) {
      if (i0 === i1) {
        return;
      }
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
  };
}

// L3DEX shares F3DEX's state commands, but B5 is a two-vertex line and
// TRI1/TRI2 draw triangle edges. The low byte of B5 is signed width, not a vertex.
export class GBI1L3DEX extends lineMicrocode(GBI1) {
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
}

// L3DEX2 keeps the GBI2 state commands, but moves Line3D operands to cmd0.
// TRI1/TRI2 draw edges with a signed width in cmd1's high byte.
// Operand reference: https://github.com/gonetz/GLideN64/blob/master/src/uCodes/L3DEX2.cpp
export class GBI2L3DEX extends lineMicrocode(GBI2) {
  executeLine3D(cmd0, cmd1, dis) {
    this.executeLines(dis, 2, (cmd0) => {
      const v0 = (cmd0 >>> 17) & 0x7f;
      const v1 = (cmd0 >>> 9) & 0x7f;
      const width = (cmd0 << 24) >> 24;
      dis?.text(`gsSPLineW3D(${v0}, ${v1}, ${width}, 0);`);
      this.pushLine(v0, v1, width, v0);
    });
  }

  executeTri1(cmd0, cmd1, dis) {
    this.executeLines(dis, 6, (cmd0, cmd1) => this.pushEdges(cmd0, dis, cmd1 >> 24));
  }

  executeTri2(cmd0, cmd1, dis) {
    this.executeLines(dis, 12, (cmd0, cmd1) => {
      const width = cmd1 >> 24;
      this.pushEdges(cmd0, dis, width);
      this.pushEdges(cmd1, dis, width);
    });
  }

  executeQuad(cmd0, cmd1, dis) {
    // L3DEX2 has no QUAD command; do not inherit F3DEX2's filled triangles.
    this.executeNoop(cmd0, cmd1, dis);
  }
}

function interpolateVertex(a, b, t) {
  const pos = {
    x: a.pos.x + (b.pos.x - a.pos.x) * t,
    y: a.pos.y + (b.pos.y - a.pos.y) * t,
    z: a.pos.z + (b.pos.z - a.pos.z) * t,
    w: a.pos.w + (b.pos.w - a.pos.w) * t,
  };

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
  if (width <= 0 || !tb.hasCapacity(2)) {
    return;
  }

  // Clip the center line before the perspective divide. Keep w positive to
  // avoid dividing by zero or projecting endpoints behind the camera, then
  // clip against the near and far depth planes. The rasterizer will clip the
  // sides of the expanded strip against the framebuffer boundaries.
  const clipPlanes = [
    p => p.w - 1e-6,
    p => p.z + p.w,
    p => p.w - p.z,
  ];

  for (const distance of clipPlanes) {
    const da = distance(a.pos);
    const db = distance(b.pos);

    // Both endpoints outside the same plane means the whole line is outside.
    if (da < 0 && db < 0) {
      return;
    }

    // For a crossing, replace only the outside endpoint with the intersection.
    // Interpolation preserves the endpoint color as well as its position.
    if (da < 0) {
      a = interpolateVertex(a, b, da / (da - db));
    } else if (db < 0) {
      b = interpolateVertex(a, b, da / (da - db));
    }
  }

  // Measure the projected direction in framebuffer pixels so the strip has
  // the same width regardless of perspective or framebuffer aspect ratio.
  const dx = (b.pos.x / b.pos.w - a.pos.x / a.pos.w) * viWidth / 2;
  const dy = (b.pos.y / b.pos.w - a.pos.y / a.pos.w) * viHeight / 2;
  const length = Math.hypot(dx, dy);

  if (!Number.isFinite(length) || length === 0) {
    return;
  }

  // A perpendicular unit vector gives the offset to either side of the line.
  // Each side is half the width away; converting pixels to device coordinates
  // contributes a factor of two, cancelling that half.
  const ox = -dy / length * width / viWidth;
  const oy = dx / length * width / viHeight;

  // Multiply by each endpoint's w to return the offset to homogeneous space.
  // Preserve depth and build new vertices so the cached endpoints stay intact.
  const offset = (v, sign) => ({
    pos: {
      x: v.pos.x + sign * ox * v.pos.w,
      y: v.pos.y + sign * oy * v.pos.w,
      z: v.pos.z,
      w: v.pos.w,
    },
    color: flatColor ?? v.color,
    u: 0,
    v: 0,
  });

  const a0 = offset(a, 1);
  const a1 = offset(a, -1);
  const b0 = offset(b, 1);
  const b1 = offset(b, -1);

  // Join the two endpoint pairs into a strip with a shared diagonal.
  tb.pushTri(a0, a1, b0);
  tb.pushTri(b0, a1, b1);
}
