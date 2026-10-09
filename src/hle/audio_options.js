import { addOptionsFolder } from '../debug/dbg_ui.js';

export const audioOptions = {
  // Whether to use high or low level emulation.
  emulationMode: 'HLE',
};

addOptionsFolder('Audio', folder => {
  folder.add(audioOptions, 'emulationMode', { LLE: 'LLE', HLE: 'HLE', Disabled: 'Disabled' }).name('Emulation Mode');
});
