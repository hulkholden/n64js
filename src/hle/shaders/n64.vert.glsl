#version 300 es
#define NEAR_CLIPPING __NEAR_CLIPPING__

uniform bool uAffine;

in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;

out highp vec4 vColor;
out highp float vShadeAlpha;
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
  // Turbo3D/T3DUX use affine RGB and UVs. Cancel perspective interpolation
  // in the fragment shader instead of dividing positions before clipping.
  highp float affineScale = uAffine ? aPosition.w : 1.0;
  // Interpolate W alongside the weighted attributes so clipping applies the
  // same interpolation to their numerator and denominator (even at w = 0).
  vAffineW = aPosition.w;
  vColor = aColor * affineScale;
  // Shade alpha (including RSP fog) is affine in screen space. WebGL lacks
  // noperspective varyings; cancel its perspective denominator in the fragment.
  vShadeAlpha = aColor.a * aPosition.w;
  vUV = aUV * affineScale;
}
