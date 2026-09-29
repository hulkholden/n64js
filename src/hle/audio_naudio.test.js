import { describe, expect, test } from 'bun:test';
import { NAudio } from './audio_naudio.js';
import { BanjoAudio } from './audio_banjo.js';
import { DonkeyKongAudio } from './audio_donkey_kong.js';
import { UnsupportedAudioCommand } from './audio_base.js';
import { getAudioHLEClass } from './hle_audio.js';
import { audioMicrocodeManifest } from './audio_microcode_manifest.js';

// Independent encodings and offsets pin the interface inferred from the RSP.
const RAM_BYTES = 0x4000;
const DMEM_BYTES = 0x1000;
const SAMPLE_BASE = 0x4f0;
const BLOCK_BYTES = 0x170;
const DRY_LEFT = 0x9d0;
const DRY_RIGHT = 0xb40;
const WET_LEFT = 0xcb0;
const WET_RIGHT = 0xe20;
const SCRATCH = 0xfa0;
const CONFIG = 0xfe0;
const RIGHT_RATE_HI = CONFIG + 8;
const RIGHT_RATE_LO = CONFIG + 10;
const STATE_ADDRESS = 0x1000;
const LOOP_STATE_ADDRESS = 0x1100;
const INPUT_OFFSET = 0x300;
const HALF_VOLUME = 0x4000;
const INIT = 1;
const LOOP = 2;
const SET_LEFT_VOLUME = 6;
const SET_RIGHT_TARGET = 4;
const OP_ADPCM = 1;
const OP_CLEAR = 2;
const OP_ENVELOPE = 3;
const OP_LOAD = 4;
const OP_RESAMPLE = 5;
const OP_SAVE = 6;
const OP_VOLUME = 9;
const OP_MOVE = 10;
const OP_MIX = 12;
const OP_INTERLEAVE = 13;
const OP_VOLUME_TAIL = 14;
const OP_LOOP = 15;
const command = (op, bits = 0) => (op << 24) | bits;

function fixture(Audio = NAudio) {
  return new Audio(new Uint8Array(RAM_BYTES), new Uint8Array(DMEM_BYTES));
}

function setEnvelope(audio, dry, wet) {
  audio.execute(command(OP_VOLUME, SET_LEFT_VOLUME << 16 | HALF_VOLUME), dry << 16 | wet);
  audio.execute(command(OP_VOLUME, HALF_VOLUME), 0);
  audio.execute(command(OP_VOLUME, SET_RIGHT_TARGET << 16 | HALF_VOLUME), 0);
  for (let p = 0; p < BLOCK_BYTES; p += 2) audio.put16(SAMPLE_BASE + p, 1000);
}

describe('NAudio family selection', () => {
  test('only exact reviewed identities select their implementation', () => {
    expect(getAudioHLEClass('naudio-standard')).toBe(NAudio);
    expect(getAudioHLEClass('naudio-banjo-kazooie')).toBe(BanjoAudio);
    expect(getAudioHLEClass('naudio-donkey-kong-64')).toBe(DonkeyKongAudio);
    for (const id of ['NAUDIO', 'naudio', null]) expect(getAudioHLEClass(id)).toBeNull();
    for (const program of audioMicrocodeManifest.programs) {
      if (program.family === 'NAUDIO') expect(fixture(getAudioHLEClass(program.id))).toBeInstanceOf(NAudio);
      if (!['ABI1', 'NAUDIO'].includes(program.family)) expect(getAudioHLEClass(program.id)).toBeNull();
    }
  });
});

for (const Audio of [NAudio, BanjoAudio, DonkeyKongAudio]) describe(Audio.name, () => {
  test('packed DMA masks RAM addresses and rounds transfer boundaries', () => {
    const audio = fixture(Audio);
    for (let i = 0; i < 24; i++) audio.ram[STATE_ADDRESS + i] = i + 1;
    audio.execute(command(OP_LOAD, 17 << 12 | 3), 0xff000000 | STATE_ADDRESS + 3);
    expect(audio.dmem.slice(SAMPLE_BASE, SAMPLE_BASE + 24)).toEqual(audio.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 24));
    audio.execute(command(OP_SAVE, 17 << 12 | 3), LOOP_STATE_ADDRESS + 7);
    expect(audio.ram.slice(LOOP_STATE_ADDRESS, LOOP_STATE_ADDRESS + 24)).toEqual(audio.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 24));
    const ram = audio.ram.slice();
    audio.execute(command(OP_SAVE), -1); // Count zero performs no DMA.
    expect(audio.ram).toEqual(ram);
  });

  test('zero clear still writes one vector and overlapping moves proceed by vectors', () => {
    const audio = fixture(Audio);
    audio.dmem.fill(255, SAMPLE_BASE, SAMPLE_BASE + 64);
    audio.execute(command(OP_CLEAR), 0);
    expect(Array.from(audio.dmem.slice(SAMPLE_BASE, SAMPLE_BASE + 17))).toEqual([...new Array(16).fill(0), 255]);
    for (let i = 0; i < 16; i++) audio.dmem[SAMPLE_BASE + i] = i;
    audio.execute(command(OP_MOVE), 16 << 16 | 32);
    expect(audio.dmem.slice(SAMPLE_BASE + 32, SAMPLE_BASE + 48)).toEqual(audio.dmem.slice(SAMPLE_BASE, SAMPLE_BASE + 16));
  });

  test('ADPCM zero count still imports loop history and saves it to the destination state', () => {
    const audio = fixture(Audio);
    for (let i = 0; i < 32; i++) audio.ram[LOOP_STATE_ADDRESS + i] = i;
    audio.execute(command(OP_LOOP), LOOP_STATE_ADDRESS);
    audio.execute(command(OP_ADPCM, STATE_ADDRESS), LOOP << 28 | INPUT_OFFSET);
    expect(audio.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 32)).toEqual(audio.ram.slice(LOOP_STATE_ADDRESS, LOOP_STATE_ADDRESS + 32));
    audio.execute(command(OP_ADPCM, STATE_ADDRESS), INIT << 28 | INPUT_OFFSET);
    expect(audio.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 32)).toEqual(new Uint8Array(32));
  });

  test('resampler INIT clears history while preserving the six unwritten state bytes', () => {
    const audio = fixture(Audio);
    audio.dmem.fill(123, SCRATCH, SCRATCH + 16);
    audio.dmem.fill(255, SAMPLE_BASE, SAMPLE_BASE + BLOCK_BYTES);
    audio.execute(command(OP_RESAMPLE, STATE_ADDRESS), INIT << 30 | INPUT_OFFSET << 2);
    expect(audio.dmem.slice(SAMPLE_BASE, SAMPLE_BASE + BLOCK_BYTES)).toEqual(new Uint8Array(BLOCK_BYTES));
    expect(audio.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 10)).toEqual(new Uint8Array(10));
    expect(Array.from(audio.ram.slice(STATE_ADDRESS + 10, STATE_ADDRESS + 16))).toEqual(new Array(6).fill(123));
  });

  test('interleave writes all 184 stereo frames into the fixed output', () => {
    const audio = fixture(Audio);
    for (let p = 0; p < BLOCK_BYTES; p += 2) {
      audio.put16(DRY_LEFT + p, p + 1);
      audio.put16(DRY_RIGHT + p, -p - 1);
    }
    audio.execute(command(OP_INTERLEAVE), 0);
    for (let p = 0; p < BLOCK_BYTES; p += 2) {
      expect(audio.s16(SAMPLE_BASE + p * 2)).toBe(p + 1);
      expect(audio.s16(SAMPLE_BASE + p * 2 + 2)).toBe(-p - 1);
    }
  });

  test('unsupported commands roll back earlier writes and buffers survive reuse', () => {
    const audio = fixture(Audio);
    audio.ram.fill(0xfe); // Exercise sign-bit preservation in the undo journal.
    const before = audio.ram.slice();
    const arrays = [audio.dmem, audio.result, audio.residual, audio.undoWords, audio.envelopeChannels[0].hi];
    audio.dmem.fill(123, SAMPLE_BASE, SAMPLE_BASE + BLOCK_BYTES);
    audio.execute(command(OP_SAVE, BLOCK_BYTES << 12), STATE_ADDRESS);
    expect(() => audio.execute(command(0))).toThrow(UnsupportedAudioCommand);
    audio.rollback();
    expect(audio.ram).toEqual(before);
    audio.reset(audio.ram, new Uint8Array(DMEM_BYTES));
    const reused = [audio.dmem, audio.result, audio.residual, audio.undoWords, audio.envelopeChannels[0].hi];
    for (let i = 0; i < arrays.length; i++) expect(reused[i]).toBe(arrays[i]);
    expect(() => audio.execute(command(OP_MIX), 1)).toThrow(UnsupportedAudioCommand);
  });
});

describe('NAudio variant differences', () => {
  test('DK64 uses the low dry/wet gain bits to complement left/right samples', () => {
    const normal = fixture(), dk = fixture(DonkeyKongAudio);
    for (const audio of [normal, dk]) {
      setEnvelope(audio, HALF_VOLUME, HALF_VOLUME + 1);
      audio.execute(command(OP_ENVELOPE, INIT << 16 | HALF_VOLUME), STATE_ADDRESS);
    }
    expect(normal.s16(DRY_LEFT)).toBe(250);
    expect(normal.s16(DRY_RIGHT)).toBe(250);
    expect(dk.s16(DRY_LEFT)).toBe(250);
    expect(dk.s16(WET_LEFT)).toBe(250);
    expect(dk.s16(DRY_RIGHT)).toBe(-250);
    expect(dk.s16(WET_RIGHT)).toBe(-250);
    expect(dk.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 80)).toEqual(normal.ram.slice(STATE_ADDRESS, STATE_ADDRESS + 80));
  });

  test('opcode 14 follows each actual SETVOL tail rather than running a pole filter', () => {
    for (const Audio of [NAudio, BanjoAudio, DonkeyKongAudio]) {
      const audio = fixture(Audio);
      audio.scalarV0 = 0x12345678;
      audio.execute(command(OP_VOLUME_TAIL, 0x4321), 0xabcdef01);
      if (Audio === DonkeyKongAudio) {
        expect(audio.u16(CONFIG)).toBe(0x4321);
        expect(audio.u16(CONFIG + 2)).toBe(0x5678);
        expect(audio.u16(CONFIG + 4)).toBe(0xef01);
      } else {
        expect(audio.u16(RIGHT_RATE_HI)).toBe(Audio === BanjoAudio ? 0x5678 : 0);
        expect(audio.u16(RIGHT_RATE_LO)).toBe(0xef01);
      }
      audio.beginCommandBatch();
      expect(audio.scalarV0).toBe(0);
    }
  });

  test('DK64 mixer aliases cease to be valid after SETLOOP changes their jump targets', () => {
    const audio = fixture(DonkeyKongAudio);
    const LOOP_POINTER = 0x0e, MIXER_TARGET_PAIR = 0x1c581c58;
    audio.view.setUint32(LOOP_POINTER, MIXER_TARGET_PAIR);
    expect(() => audio.execute(command(7), 0)).not.toThrow();
    expect(() => audio.execute(command(8), 0)).not.toThrow();
    audio.execute(command(OP_LOOP), STATE_ADDRESS);
    expect(() => audio.execute(command(7), 0)).toThrow(UnsupportedAudioCommand);
    expect(() => audio.execute(command(8), 0)).toThrow(UnsupportedAudioCommand);
  });
});
