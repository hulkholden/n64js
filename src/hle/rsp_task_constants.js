import { makeEnum } from '../enum.js';

// Task pointers may include virtual-address segment bits.
export const TASK_ADDRESS_MASK = 0x1fffffff;

// Byte offsets within libultra's OSTask structure.
export const TaskOffsets = makeEnum({
  type: 0x00,
  flags: 0x04,
  ucodeBootPtr: 0x08,
  ucodeBootSize: 0x0c,
  ucodePtr: 0x10,
  ucodeSize: 0x14,
  ucodeDataPtr: 0x18,
  ucodeDataSize: 0x1c,
  dramStackPtr: 0x20,
  dramStackSize: 0x24,
  outputBuffPtr: 0x28,
  outputBuffSize: 0x2c,
  dataPtr: 0x30,
  dataSize: 0x34,
  yieldDataPtr: 0x38,
  yieldDataSize: 0x3c,
});
