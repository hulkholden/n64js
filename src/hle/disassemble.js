import { toString32 } from '../format.js';
import { convertRGBA16Pixel } from './convert.js';
import * as gbi from './gbi.js';


export function SetOtherModeL(dis, mask, data) {
  let text;
  switch (mask) {
    case gbi.G_AC_MASK:
      text = `gsDPSetAlphaCompare(${gbi.AlphaCompare.nameOf(data)});`;
      break;
    case gbi.G_ZS_MASK:
      text = `gsDPSetDepthSource(${gbi.DepthSource.nameOf(data)});`;
      break;
    case gbi.G_RM_MASK:
      text = `gsDPSetRenderMode(${gbi.getRenderModeText(data)});`;
      break;
    default:
      text = `gsSPSetOtherMode(G_SETOTHERMODE_L, ${toString32(mask)}, ${toString32(data)}`;
      break;
  }
  dis.text(text);
}

export function SetOtherModeH(dis, mask, len, shift, data) {
  let text;
  switch (mask) {
    case gbi.G_MDSFT_BLENDMASK:
      break;
    case gbi.G_AD_MASK:
      text = `gsDPSetAlphaDither(${gbi.AlphaDither.nameOf(data)});`;
      break;
    case gbi.G_CD_MASK:
      text = `gsDPSetColorDither(${gbi.ColorDither.nameOf(data)});`;
      break;
    case gbi.G_CK_MASK:
      text = `gsDPSetCombineKey(${gbi.CombineKey.nameOf(data)});`;
      break;
    case gbi.G_TC_MASK:
      text = `gsDPSetTextureConvert(${gbi.TextureConvert.nameOf(data)});`;
      break;
    case gbi.G_TF_MASK:
      text = `gsDPSetTextureFilter(${gbi.TextureFilter.nameOf(data)});`;
      break;
    case gbi.G_TL_MASK:
      text = `gsDPSetTextureLOD(${gbi.TextureLOD.nameOf(data)});`;
      break;
    case gbi.G_TT_MASK:
      text = `gsDPSetTextureLUT(${gbi.TextureLUT.nameOf(data)});`;
      break;
    case gbi.G_TD_MASK:
      text = `gsDPSetTextureDetail(${gbi.TextureDetail.nameOf(data)});`;
      break;
    case gbi.G_TP_MASK:
      text = `gsDPSetTexturePersp(${gbi.TexturePerspective.nameOf(data)});`;
      break;
    case gbi.G_CYC_MASK:
      text = `gsDPSetCycleType(${gbi.CycleType.nameOf(data)});`;
      break;
    case gbi.G_PM_MASK:
      text = `gsDPPipelineMode(${gbi.PipelineMode.nameOf(data)});`;
      break;
    default:
      text = `gsSPSetOtherMode(G_SETOTHERMODE_H, ${toString32(mask)}, ${toString32(data)});`;
      break;
  }
  dis.text(text);
}

function makeColourText(r, g, b, a) {
  const rgb = `${r}, ${g}, ${b}`;
  const rgba = `${rgb}, ${a}`;

  if ((r < 128 && g < 128) ||
      (g < 128 && b < 128) ||
      (b < 128 && r < 128)) {
    return `<span style="color: white; background-color: rgb(${rgb})">${rgba}</span>`;
  }
  return `<span style="background-color: rgb(${rgb})">${rgba}</span>`;
}

export function makeColorTextRGBA(rgba) {
  const r = (rgba >>> 24) & 0xff;
  const g = (rgba >>> 16) & 0xff;
  const b = (rgba >>> 8) & 0xff;
  const a = (rgba) & 0xff;

  return makeColourText(r, g, b, a);
}

export function makeColorTextABGR(abgr) {
  const r = abgr & 0xff;
  const g = (abgr >>> 8) & 0xff;
  const b = (abgr >>> 16) & 0xff;
  const a = (abgr >>> 24) & 0xff;

  return makeColourText(r, g, b, a);
}

export function makeColorTextRGBA16(col) {
  return makeColorTextRGBA(convertRGBA16Pixel(col));
}
