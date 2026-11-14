import { ImageFormat, ImageSize } from '../hle/graphics/gbi.js';

const isUint32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Formats a numeric GBI image format/size pair as a short name such as CI4 or RGBA16. */
export function formatTextureName(format, size) {
  const prefix = ImageFormat.nameOf(format).replace('G_IM_FMT_', '');
  return `${prefix}${4 << size}`;
}

/** Parses a CLI texture format filter such as CI4 or RGBA16 into numeric GBI enums. */
export function parseTextureFormat(value) {
  const name = String(value).trim().toUpperCase();
  const match = /^(RGBA|YUV|CI|IA|I)(4|8|16|32)$/.exec(name);
  if (!match) {
    throw new Error('Expected a texture format such as CI4 or RGBA16');
  }
  return {
    name,
    format: ImageFormat[`G_IM_FMT_${match[1]}`],
    size: ImageSize[`G_IM_SIZ_${match[2]}b`],
  };
}

function createKeyedCounter(countField) {
  let count = 0;
  const records = new Map();
  return {
    record(info) {
      count++;
      const key = JSON.stringify(info);
      const entry = records.get(key);
      if (entry) {
        entry[countField]++;
      } else {
        records.set(key, { ...info, [countField]: 1 });
      }
    },
    total() {
      return count;
    },
    values() {
      return [...records.values()].map(entry => ({ ...entry }));
    },
  };
}

/** Creates headless emulator hooks and a snapshot builder for all inventory collectors. */
export function createInventoryCollectors() {
  const audioTasks = createKeyedCounter('tasks');
  const graphicsTasks = createKeyedCounter('tasks');
  const microcodeLoads = createKeyedCounter('loads');
  const drawModes = createKeyedCounter('draws');
  const textureFormats = new Map();

  return {
    hooks: {
      onAudioTask: info => audioTasks.record(info),
      onGraphicsTask: info => graphicsTasks.record(info),
      onMicrocodeLoad: info => microcodeLoads.record(info),
      onGraphicsMode: info => drawModes.record(info),
      onTextureUse: info => {
        const key = `${info.format}:${info.size}`;
        if (!textureFormats.has(key)) {
          textureFormats.set(key, { ...info, name: formatTextureName(info.format, info.size) });
        }
      },
    },
    snapshot() {
      return {
        'audio.taskMicrocodes': {
          version: 1,
          scope: 'task-start',
          tasks: audioTasks.total(),
          microcodes: audioTasks.values(),
        },
        'graphics.taskMicrocodes': {
          version: 1,
          scope: 'task-start',
          tasks: graphicsTasks.total(),
          microcodes: graphicsTasks.values(),
        },
        'graphics.microcodeLoads': {
          version: 1,
          scope: 'hle-load',
          loads: microcodeLoads.total(),
          microcodes: microcodeLoads.values(),
        },
        'graphics.drawModes': {
          version: 1,
          scope: 'headless-draw',
          modes: drawModes.values(),
        },
        'graphics.textureFormats': {
          version: 1,
          scope: 'hle-draw',
          formats: [...textureFormats.values()].map(entry => ({ ...entry })),
        },
      };
    },
  };
}

export const collectorSpecs = {
  graphicsMode: [{
    name: 'graphics.drawModes', scope: 'headless-draw', records: 'modes',
    validate: record => record != null &&
      ['otherModeH', 'otherModeL', 'combineHi', 'combineLo'].every(key => isUint32(record[key])) &&
      Number.isSafeInteger(record.draws) && record.draws > 0,
  }],
  audioMicrocode: [{ name: 'audio.taskMicrocodes', scope: 'task-start', records: 'microcodes', count: 'tasks' }],
  microcode: [
    { name: 'graphics.taskMicrocodes', scope: 'task-start', records: 'microcodes', count: 'tasks' },
    { name: 'graphics.microcodeLoads', scope: 'hle-load', records: 'microcodes', count: 'loads' },
  ],
  texture: [{ name: 'graphics.textureFormats', scope: 'hle-draw', records: 'formats' }],
};

export const allCollectorSpecs = Object.values(collectorSpecs).flat();

/** Validates a single collector entry and filters its records with predicate. */
export function inspectCollector(collectors, spec, predicate = () => true) {
  const data = collectors?.[spec.name];
  const result = { collector: spec.name, version: data?.version ?? null, scope: data?.scope ?? null, state: 'unknown' };
  if (!data) {
    return { ...result, reason: 'missing-collector' };
  }
  if (data.version !== 1) {
    return { ...result, reason: 'unsupported-version' };
  }
  if (data.scope !== spec.scope) {
    return { ...result, reason: 'unsupported-scope' };
  }
  const records = data[spec.records];
  const validRecord = spec.validate ?? (spec.count
    ? record => typeof record?.family === 'string' && Number.isSafeInteger(record[spec.count]) && record[spec.count] > 0
    : record => Number.isInteger(record?.format) && Number.isInteger(record?.size));
  if (!Array.isArray(records) || !records.every(validRecord)) {
    return { ...result, reason: 'invalid-records' };
  }
  const matches = records.filter(predicate);
  return { ...result, state: matches.length ? 'observed' : 'not-observed', matches };
}

/** Maps a missing or unsupported report schemaVersion to its unknown-state reason. */
export function unknownReportReason(reportVersion) {
  return reportVersion === null ? 'missing-report' : 'unsupported-report-version';
}
