import { dbgGUI } from '../dbg_ui.js';

// Whether to skip audio task emulator or run it on the RSP.
// Set this to false to enable audio in most games.
export const audioOptions = {
  // Whether to use high or low level emulation.
  emulationMode: 'LLE',
};

const folder = dbgGUI.addFolder('Audio');
folder.add(audioOptions, 'emulationMode', { LLE: 'LLE', Disabled: 'Disabled' }).name('Emulation Mode');
