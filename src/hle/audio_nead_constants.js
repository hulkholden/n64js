// Command numbers come from the captured NEAD dispatch tables. Individual
// variants override slots whose meanings changed between programs.
export const OPCODE_NOOP = 0x00;
export const OPCODE_ADPCM = 0x01;
export const OPCODE_CLEARBUFF = 0x02;
export const OPCODE_RESERVED_03 = 0x03;
export const OPCODE_ADDMIXER = 0x04;
export const OPCODE_RESAMPLE = 0x05;
export const OPCODE_RESAMPLE_NEAREST = 0x06;
export const OPCODE_FILTER = 0x07;
export const OPCODE_SETBUFF = 0x08;
export const OPCODE_RESERVED_09 = 0x09;
export const OPCODE_DMEMMOVE = 0x0a;
export const OPCODE_LOADADPCM = 0x0b;
export const OPCODE_MIXER = 0x0c;
export const OPCODE_INTERLEAVE = 0x0d;
export const OPCODE_POLEF = 0x0e;
export const OPCODE_SETLOOP = 0x0f;
export const OPCODE_COPY = 0x10;
export const OPCODE_DOWNSAMPLE = 0x11;
export const OPCODE_ENVSETUP1 = 0x12;
export const OPCODE_ENVMIXER = 0x13;
export const OPCODE_LOADBUFF = 0x14;
export const OPCODE_SAVEBUFF = 0x15;
export const OPCODE_ENVSETUP2 = 0x16;
export const OPCODE_PCM8 = 0x17;
export const OPCODE_GAIN = 0x18;
export const OPCODE_MULTIPLY = 0x19;
export const OPCODE_DUPLICATE = 0x1a;
export const OPCODE_FIR_FILTER = 0x1b;
export const OPCODE_RESERVED_1C = 0x1c;
export const OPCODE_RESERVED_1D = 0x1d;
export const OPCODE_RESERVED_1E = 0x1e;
export const OPCODE_RESERVED_1F = 0x1f;

// Shared vector and packed command fields.
export const SAMPLE_BYTES = 2;
export const VECTOR_SAMPLES = 8;
export const VECTOR_BYTES = VECTOR_SAMPLES * SAMPLE_BYTES;
export const RAM_ADDRESS_MASK = 0xffffff;
export const PACKED_BUFFER_MASK = 0xff0;
export const FLAG_INIT = 1;
export const FLAG_LOOP = 2;
export const ADPCM_HISTORY_BYTES = 2 * VECTOR_BYTES;

// Star Fox's layout is the default; earlier and direct-loading variants
// override the layout getters without changing the common command kernels.
export const DMEM_PARAMS = 0x320;
export const DMEM_COMMAND_BUFFER = 0x340;
export const COMMAND_BUFFER_SIZE = 0x80;
export const DMEM_ADPCM_BOOK = 0x3c0;
export const ADPCM_BOOK_SIZE = 0x100;
export const DMEM_SCRATCH = 0xf90;
export const DMEM_RESAMPLE_TABLE = 0x100;
export const PARAM_INPUT = 0;
export const PARAM_OUTPUT = 2;
export const PARAM_COUNT = 4;
export const PARAM_LOOP = 0x10;

// Registers and block widths retained across commands.
export const RSP_CONSTANT_VECTOR = 31;
export const DMEM_RESAMPLE_STEP_VECTOR = 0x70;
export const ADD_BLOCK_BYTES = 4 * VECTOR_BYTES;
export const DUPLICATE_BLOCK_BYTES = 8 * VECTOR_BYTES;
export const GAIN_FRACTION_BITS = 4;
export const RESAMPLE_NEAREST_LANES = 4;
export const RESAMPLE_NEAREST_BYTES = RESAMPLE_NEAREST_LANES * SAMPLE_BYTES;
export const FIR_COEFFICIENT_BYTES = VECTOR_BYTES;
export const FIR_COEFFICIENTS = VECTOR_SAMPLES;
