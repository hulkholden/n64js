import { dbgGUI } from '../dbg_ui.js';

export const graphicsOptions = {
  // Scale factor to apply to the canvas.
  canvasScale: 1,

  // Whether to halt on unimplemented commands or just log a warning.
  haltOnWarning: false,
};
const folder = dbgGUI.addFolder('Graphics');
folder.add(graphicsOptions, 'canvasScale').name('Canvas Scale').min(1).max(4).step(0.25);
folder.add(graphicsOptions, 'haltOnWarning').name('Halt on Warning');
