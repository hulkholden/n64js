#version 300 es
#define NEAR_CLIPPING __NEAR_CLIPPING__

// x: affine shade, y: affine UVs. Raw RDP can use affine shade with perspective UVs.
uniform bvec2 uAffine;

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
  // Cancel perspective interpolation independently for shade and UVs,
  // keeping homogeneous positions for clipping. Turbo3D/T3DUX enable both;
  // raw RDP triangles only need affine shade.
  highp float shadeScale = uAffine.x ? aPosition.w : 1.0;
  highp float uvScale = uAffine.y ? aPosition.w : 1.0;
  // Interpolate W alongside the weighted attributes so clipping applies the
  // same interpolation to their numerator and denominator (even at w = 0).
  vAffineW = aPosition.w;
  vColor = aColor * shadeScale;
  // Shade alpha (including RSP fog) is affine in screen space. WebGL lacks
  // noperspective varyings; cancel its perspective denominator in the fragment.
  vShadeAlpha = aColor.a * aPosition.w;
  vUV = aUV * uvScale;
}
