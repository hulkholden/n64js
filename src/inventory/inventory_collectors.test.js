import { describe, expect, test } from 'bun:test';
import { ImageFormat, ImageSize } from '../hle/graphics/gbi.js';
import {
  allCollectorSpecs,
  collectorSpecs,
  createInventoryCollectors,
  formatTextureName,
  inspectCollector,
  parseTextureFormat,
  unknownReportReason,
} from './inventory_collectors.js';

describe('inventory collectors', () => {
  test('inspectCollector classifies missing, invalid, not-observed, and observed states', () => {
    const modeSpec = collectorSpecs.graphicsMode[0];
    const audioSpec = collectorSpecs.audioMicrocode[0];
    const textureSpec = collectorSpecs.texture[0];
    const validMode = { otherModeH: 1 << 20, otherModeL: 0xc8110000, combineHi: 0, combineLo: 0, draws: 3 };

    expect(inspectCollector({}, modeSpec, () => true)).toMatchObject({
      collector: 'graphics.drawModes', version: null, scope: null, state: 'unknown', reason: 'missing-collector',
    });

    expect(inspectCollector({
      'graphics.drawModes': { version: 2, scope: 'headless-draw', modes: [] },
    }, modeSpec, () => true)).toMatchObject({
      version: 2, scope: 'headless-draw', state: 'unknown', reason: 'unsupported-version',
    });

    expect(inspectCollector({
      'graphics.drawModes': { version: 1, scope: 'other-scope', modes: [] },
    }, modeSpec, () => true)).toMatchObject({
      version: 1, scope: 'other-scope', state: 'unknown', reason: 'unsupported-scope',
    });

    for (const badCollector of [
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, draws: 0 }] },
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, otherModeL: -1 }] },
      { version: 1, scope: 'headless-draw', modes: [{ ...validMode, otherModeH: 0x1_0000_0000 }] },
      { version: 1, scope: 'headless-draw', modes: [null] },
    ]) {
      expect(inspectCollector({ 'graphics.drawModes': badCollector }, modeSpec, () => true)).toMatchObject({
        state: 'unknown', reason: 'invalid-records',
      });
    }

    expect(inspectCollector({
      'graphics.textureFormats': { version: 1, scope: 'hle-draw', formats: [{ format: 'CI', size: 0 }] },
    }, textureSpec, () => true)).toMatchObject({ state: 'unknown', reason: 'invalid-records' });

    expect(inspectCollector({
      'audio.taskMicrocodes': { version: 1, scope: 'task-start', tasks: 1, microcodes: [{ family: 'ABI1', tasks: 0 }] },
    }, audioSpec, () => true)).toMatchObject({ state: 'unknown', reason: 'invalid-records' });

    expect(inspectCollector({
      'graphics.drawModes': { version: 1, scope: 'headless-draw', modes: [validMode] },
    }, modeSpec, () => false)).toEqual({
      collector: 'graphics.drawModes', version: 1, scope: 'headless-draw', state: 'not-observed', matches: [],
    });

    expect(inspectCollector({
      'graphics.drawModes': { version: 1, scope: 'headless-draw', modes: [validMode] },
    }, modeSpec, record => record.draws === 3)).toEqual({
      collector: 'graphics.drawModes', version: 1, scope: 'headless-draw', state: 'observed', matches: [validMode],
    });
  });

  test('createInventoryCollectors produces valid empty snapshots and aggregates unique records cleanly', () => {
    const collector = createInventoryCollectors();
    const emptySnapshot = collector.snapshot();
    expect(Object.keys(emptySnapshot).sort()).toEqual(allCollectorSpecs.map(spec => spec.name).sort());
    for (const spec of allCollectorSpecs) {
      expect(inspectCollector(emptySnapshot, spec)).toMatchObject({
        collector: spec.name,
        version: 1,
        scope: spec.scope,
        state: 'not-observed',
        matches: [],
      });
    }

    collector.hooks.onAudioTask({ family: 'ABI1', detection: 'hash' });
    collector.hooks.onAudioTask({ family: 'Unknown', detection: 'unknown' });
    collector.hooks.onAudioTask({ family: 'ABI1', detection: 'hash' });

    collector.hooks.onGraphicsTask({ family: 'GBI2', detection: 'string' });
    collector.hooks.onGraphicsTask({ family: 'GBI2', detection: 'string' });

    collector.hooks.onMicrocodeLoad({ family: 'GBI2', detection: 'string' });
    collector.hooks.onMicrocodeLoad({ family: 'GBI1', detection: 'string' });
    collector.hooks.onMicrocodeLoad({ family: 'GBI2', detection: 'string' });

    const modeA = { otherModeH: 1 << 20, otherModeL: 0, combineHi: 0, combineLo: 0 };
    const modeB = { otherModeH: 0, otherModeL: 0xc8110000, combineHi: 1, combineLo: 2 };
    collector.hooks.onGraphicsMode(modeA);
    collector.hooks.onGraphicsMode(modeB);
    collector.hooks.onGraphicsMode(modeA);

    collector.hooks.onTextureUse({ format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b });
    collector.hooks.onTextureUse({ format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b });
    collector.hooks.onTextureUse({ format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b });

    const snap = collector.snapshot();
    expect(snap).toEqual({
      'audio.taskMicrocodes': {
        version: 1,
        scope: 'task-start',
        tasks: 3,
        microcodes: [
          { family: 'ABI1', detection: 'hash', tasks: 2 },
          { family: 'Unknown', detection: 'unknown', tasks: 1 },
        ],
      },
      'graphics.taskMicrocodes': {
        version: 1,
        scope: 'task-start',
        tasks: 2,
        microcodes: [{ family: 'GBI2', detection: 'string', tasks: 2 }],
      },
      'graphics.microcodeLoads': {
        version: 1,
        scope: 'hle-load',
        loads: 3,
        microcodes: [
          { family: 'GBI2', detection: 'string', loads: 2 },
          { family: 'GBI1', detection: 'string', loads: 1 },
        ],
      },
      'graphics.drawModes': {
        version: 1,
        scope: 'headless-draw',
        modes: [
          { ...modeA, draws: 2 },
          { ...modeB, draws: 1 },
        ],
      },
      'graphics.textureFormats': {
        version: 1,
        scope: 'hle-draw',
        formats: [
          { format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b, name: 'CI4' },
          { format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b, name: 'RGBA16' },
        ],
      },
    });

    for (const spec of allCollectorSpecs) {
      expect(inspectCollector(snap, spec).state).toBe('observed');
    }

    // Mutating one snapshot must not alter internal state or later snapshots.
    snap['graphics.drawModes'].modes[0].draws = 999;
    snap['graphics.textureFormats'].formats[0].name = 'MUTATED';
    const nextSnap = collector.snapshot();
    expect(nextSnap['graphics.drawModes'].modes[0].draws).toBe(2);
    expect(nextSnap['graphics.textureFormats'].formats[0].name).toBe('CI4');
  });

  test('formatTextureName and parseTextureFormat round-trip formats and reject invalid strings', () => {
    for (const [input, expected] of [
      ['CI4', { name: 'CI4', format: ImageFormat.G_IM_FMT_CI, size: ImageSize.G_IM_SIZ_4b }],
      [' rgba16 ', { name: 'RGBA16', format: ImageFormat.G_IM_FMT_RGBA, size: ImageSize.G_IM_SIZ_16b }],
      ['ia8', { name: 'IA8', format: ImageFormat.G_IM_FMT_IA, size: ImageSize.G_IM_SIZ_8b }],
      ['I32', { name: 'I32', format: ImageFormat.G_IM_FMT_I, size: ImageSize.G_IM_SIZ_32b }],
      ['yuv16', { name: 'YUV16', format: ImageFormat.G_IM_FMT_YUV, size: ImageSize.G_IM_SIZ_16b }],
    ]) {
      const parsed = parseTextureFormat(input);
      expect(parsed).toEqual(expected);
      expect(formatTextureName(parsed.format, parsed.size)).toBe(expected.name);
    }

    for (const bad of ['', '   ', 'RGBBAD', 'RGBA24', 'CI2']) {
      expect(() => parseTextureFormat(bad)).toThrow('Expected a texture format such as CI4 or RGBA16');
    }
  });

  test('unknownReportReason maps missing vs unsupported report schema versions', () => {
    expect(unknownReportReason(null)).toBe('missing-report');
    expect(unknownReportReason(2)).toBe('unsupported-report-version');
  });
});
