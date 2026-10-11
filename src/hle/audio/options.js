import { EmulationMode } from '../emulation_mode.js';
import { addOptionsFolder } from '../../debug/dbg_ui.js';

export const audioOptions = {
  // Whether to use high or low level emulation.
  emulationMode: EmulationMode.HLE,
};

addOptionsFolder('Audio', folder => {
  folder.add(audioOptions, 'emulationMode', { LLE: EmulationMode.LLE, HLE: EmulationMode.HLE, Disabled: EmulationMode.Disabled }).name('Emulation Mode');
});
