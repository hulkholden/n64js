#version 300 es
in vec4 aPosition;
in vec4 aColor;
in vec2 aUV;

out         vec4 vColor;
// Preserve N64 sub-texel precision before fragment-stage tile offsets.
out highp vec2 vUV;
#ifdef NO_NEAR_CLIPPING
out highp float vClipZ;
#endif

void main(void) {
  gl_Position = aPosition;
#ifdef NO_NEAR_CLIPPING
  // WebGL has no depth-clamp state. Keep X/Y/W clipping, and defer Z to the
  // fragment shader so vertices before the near plane survive (Wetrix).
  vClipZ = aPosition.z;
  gl_Position.z = 0.0;
#endif
  vColor = aColor;
  vUV = aUV;
}
