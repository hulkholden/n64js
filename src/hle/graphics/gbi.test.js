import { describe, expect, test } from 'bun:test';
import {
  blendOpText,
  GeometryModeGBI1,
  GeometryModeGBI2,
  getGeometryModeFlagsText,
  getRenderModeText,
  getTileText,
} from './gbi.js';

describe('getRenderModeText', () => {
  test('includes the zero-valued coverage and depth modes', () => {
    expect(getRenderModeText(0)).toBe(
      'CVG_DST_CLAMP|ZMODE_OPA, ' +
      'GBL_c1(G_BL_CLR_IN,G_BL_A_IN,G_BL_CLR_IN,G_BL_1MA) | ' +
      'GBL_c2(G_BL_CLR_IN,G_BL_A_IN,G_BL_CLR_IN,G_BL_1MA) /*0x0000*/',
    );
  });

  test.each([
    [0x0000, 'CVG_DST_CLAMP|ZMODE_OPA'],
    [0x0500, 'CVG_DST_WRAP|ZMODE_INTER'],
    [0x0a00, 'CVG_DST_FULL|ZMODE_XLU'],
    [0x0f00, 'CVG_DST_SAVE|ZMODE_DEC'],
    [0x0900, 'CVG_DST_WRAP|ZMODE_XLU'],
    [0x0200, 'CVG_DST_FULL|ZMODE_OPA'],
  ])('decodes packed fields in mode %i', (mode, text) => {
    expect(getRenderModeText(mode).split(', ')[0]).toBe(text);
  });

  test('preserves flag order and decodes the two blender cycles independently', () => {
    expect(getRenderModeText(0x12347ff8)).toBe(
      'AA_EN|Z_CMP|Z_UPD|IM_RD|CLR_ON_CVG|CVG_DST_SAVE|ZMODE_DEC|CVG_X_ALPHA|ALPHA_CVG_SEL|FORCE_BL, ' +
      'GBL_c1(G_BL_CLR_IN,G_BL_A_IN,G_BL_CLR_IN,G_BL_A_MEM) | ' +
      'GBL_c2(G_BL_CLR_MEM,G_BL_A_SHADE,G_BL_CLR_FOG,G_BL_1MA) /*0x1234*/',
    );
  });

  test('ignores non-render bits and accepts signed mode words', () => {
    expect(getRenderModeText(0x8007)).toBe(getRenderModeText(0));
    expect(getRenderModeText(0xc8102048 | 0)).toBe(getRenderModeText(0xc8102048));
  });
});

for (const [name, flags] of [['GBI1', GeometryModeGBI1], ['GBI2', GeometryModeGBI2]]) {
  describe(`getGeometryModeFlagsText ${name}`, () => {
    test('uses zero for no recognized flags', () => {
      expect(getGeometryModeFlagsText(flags, 0)).toBe('0');
      expect(getGeometryModeFlagsText(flags, 0x80000000)).toBe('0');
    });

    test.each(['G_CULL_FRONT', 'G_CULL_BACK', 'G_CULL_BOTH'])('uses one name for %s', cullName => {
      expect(getGeometryModeFlagsText(flags, flags[cullName])).toBe(cullName);
    });

    test('keeps culling between shading and lighting flags', () => {
      const data = flags.G_ZBUFFER | flags.G_SHADING_SMOOTH | flags.G_CULL_BOTH | flags.G_LIGHTING;
      expect(getGeometryModeFlagsText(flags, data)).toBe('G_ZBUFFER|G_SHADING_SMOOTH|G_CULL_BOTH|G_LIGHTING');
    });
  });
}

test('geometry modes preserve display order and omit disabled GBI2 shading', () => {
  expect(getGeometryModeFlagsText(GeometryModeGBI1, -1)).toBe(
    'G_ZBUFFER|G_TEXTURE_ENABLE|G_SHADE|G_SHADING_SMOOTH|G_CULL_BOTH|' +
    'G_FOG|G_LIGHTING|G_TEXTURE_GEN|G_TEXTURE_GEN_LINEAR|G_LOD',
  );
  expect(getGeometryModeFlagsText(GeometryModeGBI2, -1)).toBe(
    'G_ZBUFFER|G_TEXTURE_ENABLE|G_SHADING_SMOOTH|G_CULL_BOTH|' +
    'G_FOG|G_LIGHTING|G_TEXTURE_GEN|G_TEXTURE_GEN_LINEAR|G_LOD',
  );
});

test('tile names preserve numeric fallback values', () => {
  expect(getTileText(0)).toBe('G_TX_RENDERTILE');
  expect(getTileText(7)).toBe('G_TX_LOADTILE');
  expect(getTileText(3)).toBe(3);
  expect(getTileText(8)).toBe(8);
});

test('blend text decodes all four selectors without extra spaces', () => {
  expect(blendOpText(0x0123)).toBe('G_BL_CLR_IN,G_BL_A_FOG,G_BL_CLR_BL,G_BL_0');
  expect(blendOpText(0x3210)).toBe('G_BL_CLR_FOG,G_BL_A_SHADE,G_BL_CLR_MEM,G_BL_1MA');
});
