import { dbgGUI } from '../dbg_ui.js';

export const graphicsOptions = {
  // Scale factor to apply to the canvas.
  canvasScale: 1,

  // Whether to halt on unimplemented commands or just log a warning.
  haltOnWarning: false,

  // If set, dump the next RSP microcode to the console.
  dumpMicrocode: false,
  // If set, only dump microcodes containing this string.
  dumpMicrocodeSubstring: '',

  // Whether to use high or low level emulation.
  emulationMode: 'HLE',

  // Whether to dump RDP commands.
  dumpRDP: false,
};
const folder = dbgGUI.addFolder('Graphics');
folder.add(graphicsOptions, 'canvasScale').name('Canvas Scale').min(1).max(4).step(0.25);
folder.add(graphicsOptions, 'haltOnWarning').name('Halt on Warning');
folder.add(graphicsOptions, 'dumpMicrocode').name('Dump Microcode');
folder.add(graphicsOptions, 'dumpMicrocodeSubstring').name('Dump Microcode Substring');
folder.add(graphicsOptions, 'emulationMode', { 'HLE (Recommended)': 'HLE', 'LLE (Experimental, Slow)': 'LLE' }).name('Emulation Mode');
folder.add(graphicsOptions, 'dumpRDP').name('Dump RDP');
