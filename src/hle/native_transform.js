import { Transform2D } from '../graphics/Transform2D.js';
import { Transform4D } from '../graphics/Transform4D.js';
import { Vector2 } from '../graphics/Vector2.js';
import { Vector4 } from '../graphics/Vector4.js';

export class NativeTransform {
  constructor() {
    this.initDimensions(320, 240);
  }

  initDimensions(viWidth, viHeight) {
    // Games can keep drawing (including framebuffer clears) while VI scanout
    // is blanked. Retain the last usable transform instead of routing those
    // draws to a fallback target or dividing by a zero VI scale.
    if (!Number.isFinite(viWidth) || !Number.isFinite(viHeight) || viWidth <= 0 || viHeight <= 0) {
      return;
    }
    this.viWidth = viWidth;
    this.viHeight = viHeight;
    // Convert n64 framebuffer coordinates into normalised device coordinates (-1 to +1).
    this.n64FramebufferToDevice = new Transform2D(new Vector2(2 / viWidth, -2 / viHeight), new Vector2(-1, +1));

    // TODO: confirm these. I'm not sure where the z scale/trans should come from.
    const viX = viWidth / 2;
    const viY = viHeight / 2;
    // Scale by slightly more than the translate.
    // This fixes the menu in StarFox which was rendering these at z=-1.002.
    const zScale = 512;
    const zTrans = 511;

    // Note scale.y is flipped.
    const viScale = new Vector4(viX, -viY, zScale, 1);
    const viTrans = new Vector4(viX, +viY, zTrans, 0);
    this.viTransform = new Transform4D(viScale, viTrans);
  }

  // Used by fillRec/texRect - ignores viewport.
  convertN64ToDisplay(n64Vec2) {
    return this.n64FramebufferToDevice.transform(n64Vec2);
  }

  // Returns rectangle vertices in triangle-strip order at the supplied depth.
  calculateRectVertices(x0, y0, x1, y1, depth) {
    const display0 = this.convertN64ToDisplay(new Vector2(x0, y0));
    const display1 = this.convertN64ToDisplay(new Vector2(x1, y1));
    return [
      display0.x, display0.y, depth, 1.0,
      display1.x, display0.y, depth, 1.0,
      display0.x, display1.y, depth, 1.0,
      display1.x, display1.y, depth, 1.0
    ];
  }
}
