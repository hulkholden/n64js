import * as format from './format.js';

export const renderModeFlags = {
  AA_EN:               0x0008,
  Z_CMP:               0x0010,
  Z_UPD:               0x0020,
  IM_RD:               0x0040,
  CLR_ON_CVG:          0x0080,
  CVG_DST_CLAMP:       0,
  CVG_DST_WRAP:        0x0100,
  CVG_DST_FULL:        0x0200,
  CVG_DST_SAVE:        0x0300,
  ZMODE_OPA:           0,
  ZMODE_INTER:         0x0400,
  ZMODE_XLU:           0x0800,
  ZMODE_DEC:           0x0c00,
  CVG_X_ALPHA:         0x1000,
  ALPHA_CVG_SEL:       0x2000,
  FORCE_BL:            0x4000,
  TEX_EDGE:            0x0000 /* used to be 0x8000 */
};

export function getRenderModeFlagsText(data) {
  var t = '';

  if (data & renderModeFlags.AA_EN)               t += '|AA_EN';
  if (data & renderModeFlags.Z_CMP)               t += '|Z_CMP';
  if (data & renderModeFlags.Z_UPD)               t += '|Z_UPD';
  if (data & renderModeFlags.IM_RD)               t += '|IM_RD';
  if (data & renderModeFlags.CLR_ON_CVG)          t += '|CLR_ON_CVG';

  var cvg = data & 0x0300;
       if (cvg === renderModeFlags.CVG_DST_CLAMP) t += '|CVG_DST_CLAMP';
  else if (cvg === renderModeFlags.CVG_DST_WRAP)  t += '|CVG_DST_WRAP';
  else if (cvg === renderModeFlags.CVG_DST_FULL)  t += '|CVG_DST_FULL';
  else if (cvg === renderModeFlags.CVG_DST_SAVE)  t += '|CVG_DST_SAVE';

  var zmode = data & 0x0c00;
       if (zmode === renderModeFlags.ZMODE_OPA)   t += '|ZMODE_OPA';
  else if (zmode === renderModeFlags.ZMODE_INTER) t += '|ZMODE_INTER';
  else if (zmode === renderModeFlags.ZMODE_XLU)   t += '|ZMODE_XLU';
  else if (zmode === renderModeFlags.ZMODE_DEC)   t += '|ZMODE_DEC';

  if (data & renderModeFlags.CVG_X_ALPHA)         t += '|CVG_X_ALPHA';
  if (data & renderModeFlags.ALPHA_CVG_SEL)       t += '|ALPHA_CVG_SEL';
  if (data & renderModeFlags.FORCE_BL)            t += '|FORCE_BL';

  var c0 = t.length > 0 ? t.substr(1) : '0';

  var blend = data >>> G_MDSFT_BLENDER;

  var c1 = 'GBL_c1(' + blendOpText(blend>>>2) + ') | GBL_c2(' + blendOpText(blend) + ') /*' + format.toString16(blend) + '*/';

  return c0 + ', ' + c1;
}

// G_SETOTHERMODE_L sft: shift count
export const G_MDSFT_ALPHACOMPARE = 0;
export const G_MDSFT_ZSRCSEL      = 2;
export const G_MDSFT_RENDERMODE   = 3;
export const G_MDSFT_BLENDER      = 16;

export const G_AC_MASK  = 3 << G_MDSFT_ALPHACOMPARE;
export const G_ZS_MASK  = 1 << G_MDSFT_ZSRCSEL;

export function getOtherModeLShiftCountName(value) {
  switch (value) {
    case G_MDSFT_ALPHACOMPARE:  return 'G_MDSFT_ALPHACOMPARE';
    case G_MDSFT_ZSRCSEL:       return 'G_MDSFT_ZSRCSEL';
    case G_MDSFT_RENDERMODE:    return 'G_MDSFT_RENDERMODE';
    case G_MDSFT_BLENDER:       return 'G_MDSFT_BLENDER';
  }

  return format.toString8(value);
}

//G_SETOTHERMODE_H shift count
export const G_MDSFT_BLENDMASK    = 0;
export const G_MDSFT_ALPHADITHER  = 4;
export const G_MDSFT_RGBDITHER    = 6;
export const G_MDSFT_COMBKEY      = 8;
export const G_MDSFT_TEXTCONV     = 9;
export const G_MDSFT_TEXTFILT     = 12;
export const G_MDSFT_TEXTLUT      = 14;
export const G_MDSFT_TEXTLOD      = 16;
export const G_MDSFT_TEXTDETAIL   = 17;
export const G_MDSFT_TEXTPERSP    = 19;
export const G_MDSFT_CYCLETYPE    = 20;
export const G_MDSFT_COLORDITHER  = 22;
export const G_MDSFT_PIPELINE     = 23;

export function getOtherModeHShiftCountName(sft) {
  switch (sft) {

    case G_MDSFT_BLENDMASK:   return 'G_MDSFT_BLENDMASK';
    case G_MDSFT_ALPHADITHER: return 'G_MDSFT_ALPHADITHER';
    case G_MDSFT_RGBDITHER:   return 'G_MDSFT_RGBDITHER';
    case G_MDSFT_COMBKEY:     return 'G_MDSFT_COMBKEY';
    case G_MDSFT_TEXTCONV:    return 'G_MDSFT_TEXTCONV';
    case G_MDSFT_TEXTFILT:    return 'G_MDSFT_TEXTFILT';
    case G_MDSFT_TEXTLUT:     return 'G_MDSFT_TEXTLUT';
    case G_MDSFT_TEXTLOD:     return 'G_MDSFT_TEXTLOD';
    case G_MDSFT_TEXTDETAIL:  return 'G_MDSFT_TEXTDETAIL';
    case G_MDSFT_TEXTPERSP:   return 'G_MDSFT_TEXTPERSP';
    case G_MDSFT_CYCLETYPE:   return 'G_MDSFT_CYCLETYPE';
    case G_MDSFT_COLORDITHER: return 'G_MDSFT_COLORDITHER';
    case G_MDSFT_PIPELINE:    return 'G_MDSFT_PIPELINE';
  }

  return format.toString8(sft);
}

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

export const pipelineModeValues = {
  G_PM_1PRIMITIVE:   1 << G_MDSFT_PIPELINE,
  G_PM_NPRIMITIVE:   0 << G_MDSFT_PIPELINE
};

export const cycleTypeValues = {
  G_CYC_1CYCLE:     0 << G_MDSFT_CYCLETYPE,
  G_CYC_2CYCLE:     1 << G_MDSFT_CYCLETYPE,
  G_CYC_COPY:       2 << G_MDSFT_CYCLETYPE,
  G_CYC_FILL:       3 << G_MDSFT_CYCLETYPE
};

export const texturePerspValues = {
  G_TP_NONE:        0 << G_MDSFT_TEXTPERSP,
  G_TP_PERSP:       1 << G_MDSFT_TEXTPERSP
};

export const textureDetailValues = {
  G_TD_CLAMP:       0 << G_MDSFT_TEXTDETAIL,
  G_TD_SHARPEN:     1 << G_MDSFT_TEXTDETAIL,
  G_TD_DETAIL:      2 << G_MDSFT_TEXTDETAIL
};

export const textureLODValues = {
  G_TL_TILE:        0 << G_MDSFT_TEXTLOD,
  G_TL_LOD:         1 << G_MDSFT_TEXTLOD
};

export const textureLUTValues = {
  G_TT_NONE:        0 << G_MDSFT_TEXTLUT,
  G_TT_RGBA16:      2 << G_MDSFT_TEXTLUT,
  G_TT_IA16:        3 << G_MDSFT_TEXTLUT
};

export const textureFilterValues = {
  G_TF_POINT:       0 << G_MDSFT_TEXTFILT,
  G_TF_AVERAGE:     3 << G_MDSFT_TEXTFILT,
  G_TF_BILERP:      2 << G_MDSFT_TEXTFILT
};

export const textureConvertValues = {
  G_TC_CONV:       0 << G_MDSFT_TEXTCONV,
  G_TC_FILTCONV:   5 << G_MDSFT_TEXTCONV,
  G_TC_FILT:       6 << G_MDSFT_TEXTCONV
};

export const combineKeyValues = {
  G_CK_NONE:        0 << G_MDSFT_COMBKEY,
  G_CK_KEY:         1 << G_MDSFT_COMBKEY
};

export const colorDitherValues = {
  G_CD_MAGICSQ:     0 << G_MDSFT_RGBDITHER,
  G_CD_BAYER:       1 << G_MDSFT_RGBDITHER,
  G_CD_NOISE:       2 << G_MDSFT_RGBDITHER,
  G_CD_DISABLE:     3 << G_MDSFT_RGBDITHER
};

export const alphaDitherValues = {
  G_AD_PATTERN:     0 << G_MDSFT_ALPHADITHER,
  G_AD_NOTPATTERN:  1 << G_MDSFT_ALPHADITHER,
  G_AD_NOISE:       2 << G_MDSFT_ALPHADITHER,
  G_AD_DISABLE:     3 << G_MDSFT_ALPHADITHER
};

export const alphaCompareValues = {
  G_AC_NONE:          0 << G_MDSFT_ALPHACOMPARE,
  G_AC_THRESHOLD:     1 << G_MDSFT_ALPHACOMPARE,
  G_AC_DITHER:        3 << G_MDSFT_ALPHACOMPARE
};

export const depthSourceValues = {
  G_ZS_PIXEL:         0 << G_MDSFT_ZSRCSEL,
  G_ZS_PRIM:          1 << G_MDSFT_ZSRCSEL
};

const blendColourSources = [
  'G_BL_CLR_IN',
  'G_BL_CLR_MEM',
  'G_BL_CLR_BL',
  'G_BL_CLR_FOG'
];

const blendSourceFactors = [
  'G_BL_A_IN',
  'G_BL_A_FOG',
  'G_BL_A_SHADE',
  'G_BL_0'
];

const blendDestFactors = [
  'G_BL_1MA',
  'G_BL_A_MEM',
  'G_BL_1',
  'G_BL_0'
];

export function blendOpText(v) {
  var m1a = (v>>>12)&0x3;
  var m1b = (v>>> 8)&0x3;
  var m2a = (v>>> 4)&0x3;
  var m2b = (v>>> 0)&0x3;

  return blendColourSources[m1a] + ',' + blendSourceFactors[m1b] + ',' + blendColourSources[m2a] + ',' + blendDestFactors[m2b];
}
