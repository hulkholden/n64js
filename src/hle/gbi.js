import { makeEnum } from '../enum.js';
import * as format from '../format.js';

export const RenderMode = {
  AA_EN:               0x0008,
  Z_CMP:               0x0010,
  Z_UPD:               0x0020,
  IM_RD:               0x0040,
  CLR_ON_CVG:          0x0080,

  CVG_DST_CLAMP:       0x0000,
  CVG_DST_WRAP:        0x0100,
  CVG_DST_FULL:        0x0200,
  CVG_DST_SAVE:        0x0300,

  ZMODE_OPA:           0x0000,    // Opaque
  ZMODE_INTER:         0x0400,    // Interpenetrating
  ZMODE_XLU:           0x0800,    // Transparent
  ZMODE_DEC:           0x0c00,    // Decal

  // Coverage Times Alpha. If this is set and anti-aliasing is enabled then
  // the coverage value will be multiplied by the combiner alpha value.
  // If the coverage value comes out as zero then the pixel will be discarded.
  CVG_X_ALPHA:         0x1000,

  // If this is set the alpha comes from the coverage value (which depends on CVG_X_ALPHA).
  // If it's unset the alpha comes through directly, with some dithering.
  ALPHA_CVG_SEL:       0x2000,

  FORCE_BL:            0x4000,
  TEX_EDGE:            0x0000 /* used to be 0x8000 */
};

export function getRenderModeText(data) {
  let t = '';

  if (data & RenderMode.AA_EN)               t += '|AA_EN';
  if (data & RenderMode.Z_CMP)               t += '|Z_CMP';
  if (data & RenderMode.Z_UPD)               t += '|Z_UPD';
  if (data & RenderMode.IM_RD)               t += '|IM_RD';
  if (data & RenderMode.CLR_ON_CVG)          t += '|CLR_ON_CVG';

  const cvg = data & 0x0300;
       if (cvg === RenderMode.CVG_DST_CLAMP) t += '|CVG_DST_CLAMP';
  else if (cvg === RenderMode.CVG_DST_WRAP)  t += '|CVG_DST_WRAP';
  else if (cvg === RenderMode.CVG_DST_FULL)  t += '|CVG_DST_FULL';
  else if (cvg === RenderMode.CVG_DST_SAVE)  t += '|CVG_DST_SAVE';

  const zmode = data & 0x0c00;
       if (zmode === RenderMode.ZMODE_OPA)   t += '|ZMODE_OPA';
  else if (zmode === RenderMode.ZMODE_INTER) t += '|ZMODE_INTER';
  else if (zmode === RenderMode.ZMODE_XLU)   t += '|ZMODE_XLU';
  else if (zmode === RenderMode.ZMODE_DEC)   t += '|ZMODE_DEC';

  if (data & RenderMode.CVG_X_ALPHA)         t += '|CVG_X_ALPHA';
  if (data & RenderMode.ALPHA_CVG_SEL)       t += '|ALPHA_CVG_SEL';
  if (data & RenderMode.FORCE_BL)            t += '|FORCE_BL';

  const blend = data >>> G_MDSFT_BLENDER;
  const c0 = t.length > 0 ? t.substr(1) : '0';
  const c1 = 'GBL_c1(' + blendOpText(blend>>>2) + ') | GBL_c2(' + blendOpText(blend) + ') /*' + format.toString16(blend) + '*/';
  return c0 + ', ' + c1;
}

// G_SETOTHERMODE_L sft: shift count
export const G_MDSFT_ALPHACOMPARE = 0;
export const G_MDSFT_ZSRCSEL      = 2;
export const G_MDSFT_RENDERMODE   = 3;
export const G_MDSFT_BLENDER      = 16;

export const G_AC_MASK = 0x3;
export const G_ZS_MASK = 0x4;
export const G_RM_MASK = 0xffff_fff8;

// G_SETOTHERMODE_H shift count
export const G_MDSFT_BLENDMASK   = 0;
export const G_MDSFT_ALPHADITHER = 4;
export const G_MDSFT_RGBDITHER   = 6;
export const G_MDSFT_COMBKEY     = 8;
export const G_MDSFT_TEXTCONV    = 9;
export const G_MDSFT_TEXTFILT    = 12;
export const G_MDSFT_TEXTLUT     = 14;
export const G_MDSFT_TEXTLOD     = 16;
export const G_MDSFT_TEXTDETAIL  = 17;
export const G_MDSFT_TEXTPERSP   = 19;
export const G_MDSFT_CYCLETYPE   = 20;
export const G_MDSFT_COLORDITHER = 22;
export const G_MDSFT_PIPELINE    = 23;

export const MoveMemGBI2 = makeEnum({
  // Type.
  G_GBI2_MV_VIEWPORT: 8,
  G_GBI2_MV_LIGHT:    10,
  G_GBI2_MV_POINT:    12,
  G_GBI2_MV_MATRIX:   14,    // NOTE: this is in moveword table
  // Offset.
  G_GBI2_MVO_LOOKATX: 0 * 24,
  G_GBI2_MVO_LOOKATY: 1 * 24,
  G_GBI2_MVO_L0:      2 * 24,
  G_GBI2_MVO_L1:      3 * 24,
  G_GBI2_MVO_L2:      4 * 24,
  G_GBI2_MVO_L3:      5 * 24,
  G_GBI2_MVO_L4:      6 * 24,
  G_GBI2_MVO_L5:      7 * 24,
  G_GBI2_MVO_L6:      8 * 24,
  G_GBI2_MVO_L7:      9 * 24,
});

export const G_PM_MASK  = 1 << G_MDSFT_PIPELINE;
export const G_CYC_MASK = 3 << G_MDSFT_CYCLETYPE;
export const G_TP_MASK  = 1 << G_MDSFT_TEXTPERSP;
export const G_TD_MASK  = 3 << G_MDSFT_TEXTDETAIL;
export const G_TL_MASK  = 1 << G_MDSFT_TEXTLOD;
export const G_TT_MASK  = 3 << G_MDSFT_TEXTLUT;
export const G_TF_MASK  = 3 << G_MDSFT_TEXTFILT;
export const G_TC_MASK  = 7 << G_MDSFT_TEXTCONV;
export const G_CK_MASK  = 1 << G_MDSFT_COMBKEY;
export const G_CD_MASK  = 3 << G_MDSFT_RGBDITHER;
export const G_AD_MASK  = 3 << G_MDSFT_ALPHADITHER;

export const G_MTX_MODELVIEW  = 0x00;
export const G_MTX_PROJECTION = 0x01;
export const G_MTX_MUL        = 0x00;
export const G_MTX_LOAD       = 0x02;
export const G_MTX_NOPUSH     = 0x00;
export const G_MTX_PUSH       = 0x04;

export const G_DL_PUSH   = 0x00;
export const G_DL_NOPUSH = 0x01;

export const MoveWord = makeEnum({
  G_MW_MATRIX:    0x00,
  G_MW_NUMLIGHT:  0x02,
  G_MW_CLIP:      0x04,
  G_MW_SEGMENT:   0x06,
  G_MW_FOG:       0x08,
  G_MW_LIGHTCOL:  0x0a,
  G_MW_POINTS:    0x0c,
  G_MW_PERSPNORM: 0x0e,
});

export const MoveMemGBI1 = makeEnum({
  G_MV_VIEWPORT: 0x80,
  G_MV_LOOKATY:  0x82,
  G_MV_LOOKATX:  0x84,
  G_MV_L0:       0x86,
  G_MV_L1:       0x88,
  G_MV_L2:       0x8a,
  G_MV_L3:       0x8c,
  G_MV_L4:       0x8e,
  G_MV_L5:       0x90,
  G_MV_L6:       0x92,
  G_MV_L7:       0x94,
  G_MV_TXTATT:   0x96,
  G_MV_MATRIX_1: 0x9e,
  G_MV_MATRIX_2: 0x98,
  G_MV_MATRIX_3: 0x9a,
  G_MV_MATRIX_4: 0x9c,
});

export const G_MWO_NUMLIGHT       = 0x00;

export const MoveWordClip = makeEnum({
  G_MWO_CLIP_RNX: 0x04,
  G_MWO_CLIP_RNY: 0x0c,
  G_MWO_CLIP_RPX: 0x14,
  G_MWO_CLIP_RPY: 0x1c,
});

// Clip codes.
export const X_NEG = 0x01; //left
export const Y_NEG = 0x02; //bottom
export const Z_NEG = 0x04; //far
export const X_POS = 0x08; //right
export const Y_POS = 0x10; //top
export const Z_POS = 0x20; //near

export const FrustRatio = makeEnum({
  FR_NEG_FRUSTRATIO_1: 0x00000001,
  FR_POS_FRUSTRATIO_1: 0x0000ffff,
  FR_NEG_FRUSTRATIO_2: 0x00000002,
  FR_POS_FRUSTRATIO_2: 0x0000fffe,
  FR_NEG_FRUSTRATIO_3: 0x00000003,
  FR_POS_FRUSTRATIO_3: 0x0000fffd,
  FR_NEG_FRUSTRATIO_4: 0x00000004,
  FR_POS_FRUSTRATIO_4: 0x0000fffc,
  FR_NEG_FRUSTRATIO_5: 0x00000005,
  FR_POS_FRUSTRATIO_5: 0x0000fffb,
  FR_NEG_FRUSTRATIO_6: 0x00000006,
  FR_POS_FRUSTRATIO_6: 0x0000fffa,
});

export const Segments = makeEnum({
  G_MWO_SEGMENT_0: 0x00,
  G_MWO_SEGMENT_1: 0x01,
  G_MWO_SEGMENT_2: 0x02,
  G_MWO_SEGMENT_3: 0x03,
  G_MWO_SEGMENT_4: 0x04,
  G_MWO_SEGMENT_5: 0x05,
  G_MWO_SEGMENT_6: 0x06,
  G_MWO_SEGMENT_7: 0x07,
  G_MWO_SEGMENT_8: 0x08,
  G_MWO_SEGMENT_9: 0x09,
  G_MWO_SEGMENT_A: 0x0a,
  G_MWO_SEGMENT_B: 0x0b,
  G_MWO_SEGMENT_C: 0x0c,
  G_MWO_SEGMENT_D: 0x0d,
  G_MWO_SEGMENT_E: 0x0e,
  G_MWO_SEGMENT_F: 0x0f,
});

export const G_MWO_FOG            = 0x00;
export const G_MWO_aLIGHT_1       = 0x00;
export const G_MWO_bLIGHT_1       = 0x04;
export const G_MWO_aLIGHT_2       = 0x20;
export const G_MWO_bLIGHT_2       = 0x24;
export const G_MWO_aLIGHT_3       = 0x40;
export const G_MWO_bLIGHT_3       = 0x44;
export const G_MWO_aLIGHT_4       = 0x60;
export const G_MWO_bLIGHT_4       = 0x64;
export const G_MWO_aLIGHT_5       = 0x80;
export const G_MWO_bLIGHT_5       = 0x84;
export const G_MWO_aLIGHT_6       = 0xa0;
export const G_MWO_bLIGHT_6       = 0xa4;
export const G_MWO_aLIGHT_7       = 0xc0;
export const G_MWO_bLIGHT_7       = 0xc4;
export const G_MWO_aLIGHT_8       = 0xe0;
export const G_MWO_bLIGHT_8       = 0xe4;
export const G_MWO_MATRIX_XX_XY_I = 0x00;
export const G_MWO_MATRIX_XZ_XW_I = 0x04;
export const G_MWO_MATRIX_YX_YY_I = 0x08;
export const G_MWO_MATRIX_YZ_YW_I = 0x0c;
export const G_MWO_MATRIX_ZX_ZY_I = 0x10;
export const G_MWO_MATRIX_ZZ_ZW_I = 0x14;
export const G_MWO_MATRIX_WX_WY_I = 0x18;
export const G_MWO_MATRIX_WZ_WW_I = 0x1c;
export const G_MWO_MATRIX_XX_XY_F = 0x20;
export const G_MWO_MATRIX_XZ_XW_F = 0x24;
export const G_MWO_MATRIX_YX_YY_F = 0x28;
export const G_MWO_MATRIX_YZ_YW_F = 0x2c;
export const G_MWO_MATRIX_ZX_ZY_F = 0x30;
export const G_MWO_MATRIX_ZZ_ZW_F = 0x34;
export const G_MWO_MATRIX_WX_WY_F = 0x38;
export const G_MWO_MATRIX_WZ_WW_F = 0x3c;

export const ModifyVtx = makeEnum({
  G_MWO_POINT_RGBA:        0x10,
  G_MWO_POINT_ST:          0x14,
  G_MWO_POINT_XYSCREEN:    0x18,
  G_MWO_POINT_ZSCREEN:     0x1c,
});

export const NumLights = makeEnum({
  //NUMLIGHTS_0: 1,
  NUMLIGHTS_1: 1,
  NUMLIGHTS_2: 2,
  NUMLIGHTS_3: 3,
  NUMLIGHTS_4: 4,
  NUMLIGHTS_5: 5,
  NUMLIGHTS_6: 6,
  NUMLIGHTS_7: 7,
});

export const G_TX_LOADTILE   = 7;
export const G_TX_RENDERTILE = 0;

export function getTileText(tileIdx) {
  let t = tileIdx;
  if (tileIdx === G_TX_LOADTILE)   t = 'G_TX_LOADTILE';
  if (tileIdx === G_TX_RENDERTILE) t = 'G_TX_RENDERTILE';
  return t;
}

export const G_TX_WRAP       = 0x0;
export const G_TX_MIRROR     = 0x1;
export const G_TX_CLAMP      = 0x2;

export function getClampMirrorWrapText(flags) {
  switch (flags) {
    case G_TX_WRAP:              return 'G_TX_WRAP';
    case G_TX_MIRROR:            return 'G_TX_MIRROR';
    case G_TX_CLAMP:             return 'G_TX_CLAMP';
    case G_TX_MIRROR|G_TX_CLAMP: return 'G_TX_MIRROR|G_TX_CLAMP';
  }

  return flags;
}

export const ScissorMode = makeEnum({
  G_SC_NON_INTERLACE: 0,
  G_SC_ODD_INTERLACE: 3,
  G_SC_EVEN_INTERLACE: 2
});

export const GeometryModeGBI1 = {
  G_ZBUFFER:            0x00000001,
  G_TEXTURE_ENABLE:     0x00000002,  /* Microcode use only */
  G_SHADE:              0x00000004,  /* enable Gouraud interp */
  G_SHADING_SMOOTH:     0x00000200,  /* flat or smooth shaded */
  G_CULL_FRONT:         0x00001000,
  G_CULL_BACK:          0x00002000,
  G_CULL_BOTH:          0x00003000,  /* To make code cleaner */
  G_FOG:                0x00010000,
  G_LIGHTING:           0x00020000,
  G_TEXTURE_GEN:        0x00040000,
  G_TEXTURE_GEN_LINEAR: 0x00080000,
  G_LOD:                0x00100000, /* NOT IMPLEMENTED */
};

export const GeometryModeGBI2 = {
  G_TEXTURE_ENABLE:     0x2,        /* NB - not implemented as geometry mode flag in GBI2 */
  G_SHADE:              0,

  G_ZBUFFER:            0x00000001,
  G_CULL_BACK:          0x00000200,
  G_CULL_FRONT:         0x00000400,
  G_CULL_BOTH:          0x00000600,  /* To make code cleaner */
  G_FOG:                0x00010000,
  G_LIGHTING:           0x00020000,
  G_TEXTURE_GEN:        0x00040000,
  G_TEXTURE_GEN_LINEAR: 0x00080000,
  G_LOD:                0x00100000,  /* NOT IMPLEMENTED */
  G_SHADING_SMOOTH:     0x00200000,  /* flat or smooth shaded */
};

export function getGeometryModeFlagsText(flags, data) {
  let t = '';

  if (data & flags.G_ZBUFFER)               t += '|G_ZBUFFER';
  if (data & flags.G_TEXTURE_ENABLE)        t += '|G_TEXTURE_ENABLE';
  if (data & flags.G_SHADE)                 t += '|G_SHADE';
  if (data & flags.G_SHADING_SMOOTH)        t += '|G_SHADING_SMOOTH';

  const cull = data & flags.G_CULL_BOTH;
       if (cull === flags.G_CULL_FRONT)     t += '|G_CULL_FRONT';
  else if (cull === flags.G_CULL_BACK)      t += '|G_CULL_BACK';
  else if (cull === flags.G_CULL_BOTH)      t += '|G_CULL_BOTH';

  if (data & flags.G_FOG)                   t += '|G_FOG';
  if (data & flags.G_LIGHTING)              t += '|G_LIGHTING';
  if (data & flags.G_TEXTURE_GEN)           t += '|G_TEXTURE_GEN';
  if (data & flags.G_TEXTURE_GEN_LINEAR)    t += '|G_TEXTURE_GEN_LINEAR';
  if (data & flags.G_LOD)                   t += '|G_LOD';

  return t.length > 0 ? t.substr(1) : '0';
}

export const ImageFormat = makeEnum({
  G_IM_FMT_RGBA:    0,
  G_IM_FMT_YUV:     1,
  G_IM_FMT_CI:      2,
  G_IM_FMT_IA:      3,
  G_IM_FMT_I:       4,
});

export const ImageSize = makeEnum({
  G_IM_SIZ_4b:      0,
  G_IM_SIZ_8b:      1,
  G_IM_SIZ_16b:     2,
  G_IM_SIZ_32b:     3,
});

export const PipelineMode = makeEnum({
  G_PM_1PRIMITIVE:   1 << G_MDSFT_PIPELINE,
  G_PM_NPRIMITIVE:   0 << G_MDSFT_PIPELINE,
});

export const CycleType = makeEnum({
  G_CYC_1CYCLE:     0 << G_MDSFT_CYCLETYPE,
  G_CYC_2CYCLE:     1 << G_MDSFT_CYCLETYPE,
  G_CYC_COPY:       2 << G_MDSFT_CYCLETYPE,
  G_CYC_FILL:       3 << G_MDSFT_CYCLETYPE,
});

export const TexturePerspective = makeEnum({
  G_TP_NONE:        0 << G_MDSFT_TEXTPERSP,
  G_TP_PERSP:       1 << G_MDSFT_TEXTPERSP,
});

export const TextureDetail = makeEnum({
  G_TD_CLAMP:       0 << G_MDSFT_TEXTDETAIL,
  G_TD_SHARPEN:     1 << G_MDSFT_TEXTDETAIL,
  G_TD_DETAIL:      2 << G_MDSFT_TEXTDETAIL,
});

export const TextureLOD = makeEnum({
  G_TL_TILE:        0 << G_MDSFT_TEXTLOD,
  G_TL_LOD:         1 << G_MDSFT_TEXTLOD,
});

export const TextureLUT = makeEnum({
  G_TT_NONE:        0 << G_MDSFT_TEXTLUT,
  G_TT_RGBA16:      2 << G_MDSFT_TEXTLUT,
  G_TT_IA16:        3 << G_MDSFT_TEXTLUT,
});

export const TextureFilter = makeEnum({
  G_TF_POINT:       0 << G_MDSFT_TEXTFILT,
  G_TF_AVERAGE:     3 << G_MDSFT_TEXTFILT,
  G_TF_BILERP:      2 << G_MDSFT_TEXTFILT,
});

export const TextureConvert = makeEnum({
  G_TC_CONV:       0 << G_MDSFT_TEXTCONV,
  G_TC_FILTCONV:   5 << G_MDSFT_TEXTCONV,
  G_TC_FILT:       6 << G_MDSFT_TEXTCONV,
});

export const CombineKey = makeEnum({
  G_CK_NONE:        0 << G_MDSFT_COMBKEY,
  G_CK_KEY:         1 << G_MDSFT_COMBKEY,
});

export const ColorDither = makeEnum({
  G_CD_MAGICSQ:     0 << G_MDSFT_RGBDITHER,
  G_CD_BAYER:       1 << G_MDSFT_RGBDITHER,
  G_CD_NOISE:       2 << G_MDSFT_RGBDITHER,
  G_CD_DISABLE:     3 << G_MDSFT_RGBDITHER,
});

export const AlphaDither = makeEnum({
  G_AD_PATTERN:     0 << G_MDSFT_ALPHADITHER,
  G_AD_NOTPATTERN:  1 << G_MDSFT_ALPHADITHER,
  G_AD_NOISE:       2 << G_MDSFT_ALPHADITHER,
  G_AD_DISABLE:     3 << G_MDSFT_ALPHADITHER,
});

export const AlphaCompare = makeEnum({
  G_AC_NONE:          0 << G_MDSFT_ALPHACOMPARE,
  G_AC_THRESHOLD:     1 << G_MDSFT_ALPHACOMPARE,
  G_AC_DITHER:        3 << G_MDSFT_ALPHACOMPARE,
});

export const DepthSource = makeEnum({
  G_ZS_PIXEL:         0 << G_MDSFT_ZSRCSEL,
  G_ZS_PRIM:          1 << G_MDSFT_ZSRCSEL,
});

const blendColourSources = [
  'G_BL_CLR_IN',
  'G_BL_CLR_MEM',
  'G_BL_CLR_BL',
  'G_BL_CLR_FOG',
];

const blendSourceFactors = [
  'G_BL_A_IN',
  'G_BL_A_FOG',
  'G_BL_A_SHADE',
  'G_BL_0',
];

const blendDestFactors = [
  'G_BL_1MA',
  'G_BL_A_MEM',
  'G_BL_1',
  'G_BL_0',
];

export function blendOpText(v) {
  const m1a = (v>>>12)&0x3;
  const m1b = (v>>> 8)&0x3;
  const m2a = (v>>> 4)&0x3;
  const m2b = (v>>> 0)&0x3;

  return blendColourSources[m1a] + ',' + blendSourceFactors[m1b] + ',' + blendColourSources[m2a] + ',' + blendDestFactors[m2b];
}
