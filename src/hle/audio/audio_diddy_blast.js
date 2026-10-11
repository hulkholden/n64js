import { GoldenEyeAudio } from './audio_goldeneye.js';

const DMEM_RESAMPLE_TABLE = 0x0d0;

// Diddy Kong Racing and Blast Corps share this captured program. Its additive
// envelope instructions match GoldenEye, while the resampler constants move
// by one vector. DMA scheduling and MIXER prefetching differ but preserve the
// shared handlers' results for the supported buffer domain.
export class DiddyBlastAudio extends GoldenEyeAudio {
  get resampleTable() { return DMEM_RESAMPLE_TABLE; }
}
