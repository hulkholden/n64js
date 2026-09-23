#version 300 es
#define NEAR_CLIPPING __NEAR_CLIPPING__

in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;

out         vec4 vColor;
out highp float vShadeAlpha;
// Preserve N64 sub-texel precision before fragment-stage tile offsets.
out highp vec2 vUV;
#if !NEAR_CLIPPING
out highp float vClipZ;
#endif

void main(void) {
  gl_Position = aPosition;
#if !NEAR_CLIPPING
  // WebGL has no depth-clamp state. Keep X/Y/W clipping, and defer Z to the
  // fragment shader so vertices before the near plane survive (Wetrix).
  vClipZ = aPosition.z;
  gl_Position.z = 0.0;
#endif
  vColor = aColor;
  // Shade alpha (including RSP fog) is affine in screen space. WebGL lacks
  // noperspective varyings; cancel its perspective denominator in the fragment.
  vShadeAlpha = aColor.a * aPosition.w;
  vUV = aUV;
}
