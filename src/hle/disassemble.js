import { toString32 } from '../format.js';
import * as gbi from '../gbi.js';


export function SetOtherModeL(dis, len, shift, data) {
  const dataStr = toString32(data);
  const shiftStr = gbi.getOtherModeLShiftCountName(shift);
  let text = `gsSPSetOtherMode(G_SETOTHERMODE_L, ${shiftStr}, ${len}, ${dataStr});`;

  // Override generic text with specific functions if known
  switch (shift) {
    case gbi.G_MDSFT_ALPHACOMPARE:
      if (len === 2) {
        text = `gsDPSetAlphaCompare(${gbi.AlphaCompare.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_ZSRCSEL:
      if (len === 1) {
        text = `gsDPSetDepthSource(${gbi.DepthSource.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_RENDERMODE:
      if (len === 29) {
        text = `gsDPSetRenderMode(${gbi.getRenderModeText(data)});`;
      }
      break;
      //case gbi.G_MDSFT_BLENDER:     break; // set with G_MDSFT_RENDERMODE
  }
  dis.text(text);
}

export function SetOtherModeH(dis, len, shift, data) {
  const shiftStr = gbi.getOtherModeHShiftCountName(shift);
  const dataStr = toString32(data);
  let text = `gsSPSetOtherMode(G_SETOTHERMODE_H, ${shiftStr}, ${len}, ${dataStr});`;

  // Override generic text with specific functions if known
  switch (shift) {
    case gbi.G_MDSFT_BLENDMASK:
      break;
    case gbi.G_MDSFT_ALPHADITHER:
      if (len === 2) {
        text = `gsDPSetAlphaDither(${gbi.AlphaDither.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_RGBDITHER:
      if (len === 2) {
        text = `gsDPSetColorDither(${gbi.ColorDither.nameOf(data)});`;
      }
      break; // NB HW2?
    case gbi.G_MDSFT_COMBKEY:
      if (len === 1) {
        text = `gsDPSetCombineKey(${gbi.CombineKey.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTCONV:
      if (len === 3) {
        text = `gsDPSetTextureConvert(${gbi.TextureConvert.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTFILT:
      if (len === 2) {
        text = `gsDPSetTextureFilter(${gbi.TextureFilter.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTLOD:
      if (len === 1) {
        text = `gsDPSetTextureLOD(${gbi.TextureLOD.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTLUT:
      if (len === 2) {
        text = `gsDPSetTextureLUT(${gbi.TextureLUT.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTDETAIL:
      if (len === 2) {
        text = `gsDPSetTextureDetail(${gbi.TextureDetail.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_TEXTPERSP:
      if (len === 1) {
        text = `gsDPSetTexturePersp(${gbi.TexturePerspective.nameOf(data)});`;
      }
      break;
    case gbi.G_MDSFT_CYCLETYPE:
      if (len === 2) {
        text = `gsDPSetCycleType(${gbi.CycleType.nameOf(data)});`;
      }
      break;
    // case gbi.G_MDSFT_COLORDITHER: if (len === 1) text = `gsDPSetColorDither(${dataStr});`; break;  // NB HW1?
    case gbi.G_MDSFT_PIPELINE:
      if (len === 1) {
        text = `gsDPPipelineMode(${gbi.PipelineMode.nameOf(data)});`;
      }
      break;
  }
  dis.text(text);
}
