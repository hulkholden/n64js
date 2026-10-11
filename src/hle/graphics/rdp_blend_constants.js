// RDP blender selector encodings.
// G_BL_CLR_IN * G_BL_A_IN + G_BL_CLR_IN * G_BL_1MA.
export const kIncomingColorWithItself = 0x0000;
// G_BL_CLR_IN * G_BL_0 + G_BL_CLR_IN * G_BL_1.
export const kIncomingColorPassThrough = 0x0302;
// G_BL_CLR_FOG * G_BL_A_SHADE + G_BL_CLR_IN * G_BL_1MA.
export const kFogColorWithShadeAlpha = 0x3200;
// G_BL_CLR_IN * G_BL_A_SHADE + G_BL_CLR_FOG * G_BL_1MA.
export const kIncomingColorWithShadeAlpha = 0x0230;
// G_BL_CLR_IN * G_BL_A_IN + G_BL_CLR_MEM * G_BL_1MA.
export const kIncomingColorWithSourceAlpha = 0x0010;
// G_BL_CLR_IN * G_BL_A_IN + G_BL_CLR_MEM * G_BL_A_MEM.
export const kIncomingColorWithMemoryAlpha = 0x0011;
// G_BL_CLR_IN * G_BL_A_FOG + G_BL_CLR_MEM * G_BL_1MA.
export const kIncomingColorWithFogAlpha = 0x0110;
// G_BL_CLR_FOG * G_BL_A_FOG + G_BL_CLR_MEM * G_BL_1MA.
export const kFogColorWithFramebuffer = 0x3110;
// G_BL_CLR_IN * G_BL_0 + G_BL_CLR_MEM * G_BL_1MA.
export const kZeroIncomingWithFramebuffer = 0x0310;
// G_BL_CLR_MEM * G_BL_0 + G_BL_CLR_MEM * G_BL_1MA.
export const kZeroFramebufferWithFramebuffer = 0x1310;
