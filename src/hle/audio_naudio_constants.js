// DMEM and command layouts derived from the three reviewed NAUDIO programs.
import { FIXED16_ONE } from './audio_fixed_point.js';

// Packed commands use 24-bit RDRAM addresses and 12-bit DMEM offsets.
export const RAM_ADDRESS_MASK = 0x00ffffff;
export const BUFFER_OFFSET_MASK = 0x0fff;

// Vector operations process eight 16-bit samples at a time.
export const VECTOR_BYTES = 16;
export const VECTOR_SAMPLES = VECTOR_BYTES / 2;

// Low DMEM holds the loop pointer, resampling table and command batches.
export const DMEM_LOOP_ADDRESS = 0x00e;
export const DMEM_RESAMPLE_TABLE = 0x0b0;
export const DMEM_COMMAND_BUFFER = 0x2b0;
export const COMMAND_BUFFER_SIZE = 0x140;

// The ADPCM predictor book sits immediately before the sample buffers.
export const DMEM_ADPCM_BOOK = 0x3f0;
export const ADPCM_BOOK_SIZE = 0x100;

// Fixed-size mono buffers feed the dry and wet stereo outputs.
export const DMEM_SAMPLE_BUFFER = 0x4f0;
export const MONO_BYTES = 0x170;
export const DMEM_SECOND_BUFFER = DMEM_SAMPLE_BUFFER + MONO_BYTES;
export const DMEM_DRY_LEFT = 0x9d0;
export const DMEM_DRY_RIGHT = DMEM_DRY_LEFT + MONO_BYTES;
export const DMEM_WET_LEFT = DMEM_DRY_RIGHT + MONO_BYTES;
export const DMEM_WET_RIGHT = DMEM_WET_LEFT + MONO_BYTES;

// DSP handlers reuse this scratch area to load and save their state.
export const DMEM_SCRATCH = 0xfa0;

// Resampler state contains four history samples and a fractional phase.
export const RESAMPLE_PHASE = DMEM_SCRATCH + 8;
export const RESAMPLE_STATE_SIZE = 16;
export const RESAMPLE_HISTORY_SIZE = 8;

// The high six phase bits select a row of four 16-bit coefficients.
export const RESAMPLE_PHASE_SHIFT = 10;
export const RESAMPLE_TABLE_STRIDE = 8;

// Envelope state has integer/fractional volume vectors for both channels,
// followed by a configuration vector with targets, rates and dry/wet gains.
export const ENVELOPE_CONFIG = DMEM_SCRATCH + 4 * VECTOR_BYTES;
export const ENVELOPE_STATE_SIZE = 5 * VECTOR_BYTES;
export const ENVELOPE_CHANNEL_SIZE = 2 * VECTOR_BYTES;
export const ENVELOPE_CONFIG_STRIDE = 6;
export const ENVELOPE_DRY_VOLUME = ENVELOPE_CONFIG + 12;
export const ENVELOPE_WET_VOLUME = ENVELOPE_CONFIG + 14;

// Initial left volume sits outside the saved state; ramp weights span a vector.
export const ENVELOPE_INITIAL_LEFT = DMEM_SCRATCH + ENVELOPE_STATE_SIZE;
export const ENVELOPE_WEIGHT_STEP = FIXED16_ONE / VECTOR_SAMPLES;
