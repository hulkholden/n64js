import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import '../headless/headless_env.js';
import { createTestEmulator } from '../cpu/test_helpers.js';

const { R4300DebugState } = await import('./debugger.js');

function installMockDocument() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      if (tag === 'table') {
        const rows = [];
        const body = {
          rows,
          insertRow() {
            const cells = [];
            const row = {
              cells,
              style: {},
              insertCell() {
                const cell = { textContent: '', className: '', style: {} };
                cells.push(cell);
                return cell;
              },
            };
            rows.push(row);
            return row;
          },
        };
        const table = {
          className: '',
          tBodies: [],
          createTBody() {
            table.tBodies.push(body);
            return body;
          },
        };
        return table;
      }
      return { style: {} };
    },
  };
  return () => {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  };
}

describe('R4300DebugState.makeCop1RegistersTable', () => {
  let restoreDocument;

  beforeEach(() => {
    restoreDocument = installMockDocument();
  });

  afterEach(() => {
    restoreDocument();
  });

  test('displays all 32 64-bit COP1 registers using copRegIdx mappings in FR=1 mode', async () => {
    const { hardware } = await createTestEmulator();
    const { cpu1 } = hardware;
    cpu1.reset();
    cpu1.fullMode = true;

    cpu1.store32(cpu1.copRegIdx32(1), 0x3fc00000); // 1.5f
    cpu1.regF64[cpu1.copRegIdx64(3)] = 3.25;
    cpu1.store32(cpu1.copRegIdx32(20), 0x40200000); // 2.5f

    const table = new R4300DebugState().makeCop1RegistersTable(new Map());
    const rows = table.tBodies[0].rows.map(row => row.cells.map(cell => cell.textContent));

    expect(rows[1].slice(0, 3)).toEqual(['f01', '0x3fc00000', 1.5]);
    expect(rows[3][3]).toBe(3.25);
    expect(rows[20].slice(0, 3)).toEqual(['f20', '0x40200000', 2.5]);
  });

  test('displays even/odd register pairs using copRegIdx mappings in FR=0 mode', async () => {
    const { hardware } = await createTestEmulator();
    const { cpu1 } = hardware;
    cpu1.reset();
    cpu1.fullMode = false;

    cpu1.store32(cpu1.copRegIdx32(2), 0x3fc00000); // 1.5f
    cpu1.store32(cpu1.copRegIdx32(3), 0x40000000); // 2.0f
    cpu1.regF64[cpu1.copRegIdx64(4)] = 6.5;

    const table = new R4300DebugState().makeCop1RegistersTable(new Map());
    const rows = table.tBodies[0].rows.map(row => row.cells.map(cell => cell.textContent));

    expect(rows[2].slice(0, 3)).toEqual(['f02', '0x3fc00000', 1.5]);
    expect(rows[3]).toEqual(['f03', '0x40000000', 2, '']);
    expect(rows[4][3]).toBe(6.5);
  });
});
