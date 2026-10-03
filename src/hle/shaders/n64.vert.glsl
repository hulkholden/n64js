#version 300 es
#define NEAR_CLIPPING __NEAR_CLIPPING__

uniform bool uAffineUV;

in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;

out highp vec4 vColor;
out highp float vAffineW;
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
  // RDP shade RGBA (including fog alpha) is always affine in screen space.
  // WebGL lacks noperspective varyings, so cancel perspective interpolation
  // in the fragment shader while preserving homogeneous positions for clipping.
  highp float uvScale = uAffineUV ? aPosition.w : 1.0;
  // Interpolate W alongside the weighted attributes so clipping applies the
  // same interpolation to their numerator and denominator (even at w = 0).
  vAffineW = aPosition.w;
  vColor = aColor * aPosition.w;
  vUV = aUV * uvScale;
}
