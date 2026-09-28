import { ABI1Audio } from './audio_abi1.js';
import {
  FIXED16_ONE, UINT16_MAX, clamp16, unsigned16, fixed16FromParts, fixed16ToInt,
  clampFixed16Hi, clampFixed16Lo,
} from './audio_fixed_point.js';

const ENVELOPE_WEIGHT_STEP = FIXED16_ONE / 8;
const ENVELOPE_WEIGHT_MAX = UINT16_MAX;

// Derived from the captured GoldenEye program.
// Only envelope progression differs. Buffer handling, target selection, mixing
// and the five-vector saved state remain shared with standard ABI1.
export class GoldenEyeAudio extends ABI1Audio {
  initializeEnvelope(channel, initial) {
    // 0x1c08–0x1c20 / 0x1c64–0x1c7c interpolate an additive signed 16.16
    // increment across eight lanes, with the final weight just below one.
    const increment = fixed16FromParts(channel.rateHi, channel.rateLo);
    const initialFixed = fixed16FromParts(initial, 0);
    for (let lane = 0; lane < 8; lane++) {
      const weight = lane === 7 ? ENVELOPE_WEIGHT_MAX : (lane + 1) * ENVELOPE_WEIGHT_STEP;
      const value = initialFixed + fixed16ToInt(increment * weight);
      channel.hi[lane] = clampFixed16Hi(value);
      channel.lo[lane] = clampFixed16Lo(value);
    }
  }

  advanceEnvelope(channel) {
    // VADDC wraps the unsigned fractional sum and carries into VADD, which
    // saturates the signed integer sum. Overflow does not saturate the fraction.
    for (let lane = 0; lane < 8; lane++) {
      const fraction = channel.lo[lane] + channel.rateLo;
      channel.hi[lane] = clamp16(channel.hi[lane] + channel.rateHi + (fraction >>> 16));
      channel.lo[lane] = unsigned16(fraction);
    }
  }
}
