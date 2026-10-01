import { describe, expect, test } from 'bun:test';
import { NEADAudio } from './audio_nead.js';
import { MarioKartAudio } from './audio_mario_kart.js';
import { StarFoxRevisionAudio } from './audio_star_fox.js';
import { ShindouAudio, WaveRaceAudio } from './audio_shindou.js';
import { NEADDirectAudio, SnowboardingAudio, OcarinaAudio, MajoraAudio, AnimalForestAudio, FZeroAudio } from './audio_nead_direct.js';
import { UnsupportedAudioCommand } from './audio_base.js';
import { getAudioHLEClass } from './hle_audio.js';

// Independent encodings pin the interfaces derived from the captured programs.
const RAM_BYTES = 0x4000;
const DMEM_BYTES = 0x1000;
const INPUT = 0x600;
const OUTPUT = 0x900;
const STATE = 0x2000;
const LOOP_STATE = 0x2100;
const VECTOR_BYTES = 16;
const ADPCM_HISTORY_BYTES = 32;
const INIT = 1;
const TWO_BIT_ADPCM = 4;
const OP_ADPCM = 1;
const OP_CLEAR = 2;
const OP_ADD = 4;
const OP_RESAMPLE = 5;
const OP_FILTER = 7;
const OP_BUFFERS = 8;
const OP_MOVE = 10;
const OP_MIX = 12;
const OP_INTERLEAVE = 13;
const OP_LOOP = 15;
const OP_SETUP1 = 18;
const OP_ENVELOPE = 19;
const OP_LOAD = 20;
const OP_SAVE = 21;
const OP_SETUP2 = 22;
const OP_PCM8 = 23;
const command = (op, bits = 0) => op << 24 | bits;

const variants = [
  ['nead-mario-kart', MarioKartAudio], ['nead-star-fox', NEADAudio],
  ['nead-star-fox-revision', StarFoxRevisionAudio], ['nead-mario-shindou', ShindouAudio],
  ['nead-wave-race-shindou', WaveRaceAudio], ['nead-yoshi-story', NEADDirectAudio],
  ['nead-1080', SnowboardingAudio], ['nead-ocarina', OcarinaAudio],
  ['nead-majora-stadium', MajoraAudio], ['nead-animal-forest', AnimalForestAudio], ['nead-f-zero', FZeroAudio],
];

function fixture(Audio = NEADAudio) {
  const a = new Audio(new Uint8Array(RAM_BYTES), new Uint8Array(DMEM_BYTES));
  a.initializeTask({ getVecU16: () => 0 });
  a.execute(command(OP_BUFFERS, INPUT - a.bufferBase), (OUTPUT - a.bufferBase) << 16 | VECTOR_BYTES);
  return a;
}

for (const [identity, Audio] of variants) describe(identity, () => {
  test('dispatch uses the exact reviewed identity', () => {
    expect(getAudioHLEClass(identity)).toBe(Audio);
    expect(getAudioHLEClass(`${identity}-unreviewed`)).toBeNull();
    expect(getAudioHLEClass('NEAD')).toBeNull();
  });

  test('packed transfers align addresses; a late failure can undo overlapping stores', () => {
    const a = fixture(Audio);
    for (let i = 0; i < 32; i++) a.ram[STATE + i] = i + 1;
    a.execute(command(OP_LOAD, 32 << 12 | INPUT - a.bufferBase + 3), STATE + 7);
    expect(a.dmem.slice(INPUT, INPUT + 32)).toEqual(a.ram.slice(STATE, STATE + 32));
    a.ram.fill(0xfe, LOOP_STATE, LOOP_STATE + 48);
    a.execute(command(OP_SAVE, 32 << 12 | INPUT - a.bufferBase), LOOP_STATE);
    a.execute(command(OP_SAVE, 32 << 12 | INPUT - a.bufferBase), LOOP_STATE + 8);
    expect(() => a.execute(command(0xff), 0)).toThrow(UnsupportedAudioCommand);
    a.rollback();
    expect(a.ram.slice(LOOP_STATE, LOOP_STATE + 48)).toEqual(new Uint8Array(48).fill(0xfe));
  });

  test('clear zero does nothing and loop addresses use each variant parameter layout', () => {
    const a = fixture(Audio);
    a.dmem.fill(0x55, INPUT, INPUT + VECTOR_BYTES);
    a.execute(command(OP_CLEAR, INPUT - a.bufferBase), 0);
    expect(a.dmem[INPUT]).toBe(0x55);
    a.execute(command(OP_LOOP), LOOP_STATE);
    expect(a.loopAddress).toBe(LOOP_STATE);
  });

  test('scratch arrays and journal capacity survive task reuse', () => {
    const a = fixture(Audio);
    const buffers = [a.samples, a.result, a.residual, a.envelopeVolumes, a.envelopeRates, a.envelopeOutputs, a.copyBlock, a.multiplyCoefficients, a.undoWords];
    a.execute(command(OP_SAVE, 32 << 12 | INPUT - a.bufferBase), STATE);
    a.commit();
    a.reset(a.ram, a.dmem);
    const reused = [a.samples, a.result, a.residual, a.envelopeVolumes, a.envelopeRates, a.envelopeOutputs, a.copyBlock, a.multiplyCoefficients, a.undoWords];
    for (let i = 0; i < buffers.length; i++) expect(reused[i]).toBe(buffers[i]);
  });
});

test('the add mixer consumes the entry vector carry only for the first vector', () => {
  const a = fixture();
  a.initializeTask({ getVecU16: (_r, lane) => lane === 0 ? 0x8000 : 0 });
  a.execute(command(OP_ADD, 64 << 12), INPUT << 16 | OUTPUT);
  expect(a.s16(OUTPUT)).toBe(1);
  expect(a.s16(OUTPUT + 2)).toBe(0);
  expect(a.s16(OUTPUT + VECTOR_BYTES)).toBe(0);
  const published = new Int16Array(8);
  a.finishTask({ setVecS16: (_r, lane, value) => { published[lane] = value; } });
  expect(published[0]).toBe(0);
});

test('later resampling preserves the unused saved-state tail on INIT', () => {
  const a = fixture(NEADDirectAudio);
  a.dmem.fill(0xa5, a.scratch + 10, a.scratch + 32);
  a.execute(command(OP_RESAMPLE, INIT << 16), STATE);
  expect(a.ram.slice(STATE + 10, STATE + 32)).toEqual(new Uint8Array(22).fill(0xa5));
});

test('two-bit residuals decode in high-to-low order with signed values', () => {
  const a = fixture(OcarinaAudio);
  a.put16(a.parameters + 4, 32);
  a.dmem[INPUT] = 0;
  a.dmem.fill(0x1b, INPUT + 1, INPUT + 5); // 0, +1, -2, -1.
  a.execute(command(OP_ADPCM, (INIT | TWO_BIT_ADPCM) << 16), STATE);
  expect(Array.from({ length: 16 }, (_, i) => a.s16(OUTPUT + ADPCM_HISTORY_BYTES + i * 2)))
    .toEqual([0, 1, -2, -1, 0, 1, -2, -1, 0, 1, -2, -1, 0, 1, -2, -1]);
});

test('ADPCM can overwrite consumed input but rejects overwriting unread frames', () => {
  const a = fixture();
  a.put16(a.parameters, OUTPUT + 60);
  a.put16(a.parameters + 4, 64);
  expect(() => a.execute(command(OP_ADPCM, INIT << 16), STATE)).not.toThrow();
  a.put16(a.parameters, OUTPUT + 40);
  expect(() => a.execute(command(OP_ADPCM, INIT << 16), STATE)).toThrow(UnsupportedAudioCommand);
});

test('PCM8 sign extension produces signed 16-bit PCM after the history prefix', () => {
  const a = fixture();
  a.dmem.set([0, 0x7f, 0x80, 0xff], INPUT);
  a.execute(command(OP_PCM8, INIT << 16), STATE);
  expect(Array.from({ length: 4 }, (_, i) => a.s16(OUTPUT + ADPCM_HISTORY_BYTES + i * 2))).toEqual([0, 32512, -32768, -256]);
});

test('Majora and Animal Forest have different zero-length move behavior', () => {
  for (const [Audio, expected] of [[MajoraAudio, 1234], [AnimalForestAudio, 0]]) {
    const a = fixture(Audio);
    a.put16(INPUT, 1234);
    a.execute(command(OP_MOVE, INPUT), OUTPUT << 16);
    expect(a.s16(OUTPUT)).toBe(expected);
  }
});

test('packed interleave ignores SETBUFF count and writes four-lane groups', () => {
  const a = fixture(ShindouAudio);
  a.put16(a.parameters + 4, 0);
  for (let i = 0; i < 8; i++) { a.put16(INPUT + i * 2, i); a.put16(INPUT + 32 + i * 2, -i); }
  a.execute(command(OP_INTERLEAVE, 16 << 12 | OUTPUT), INPUT << 16 | INPUT + 32);
  expect(Array.from({ length: 8 }, (_, i) => a.s16(OUTPUT + i * 4))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(a.s16(OUTPUT + 30)).toBe(-7);
});

test('mixing into an earlier overlapping buffer preserves source samples', () => {
  const a = fixture();
  for (let i = 0; i < 32; i++) a.put16(INPUT - 16 + i * 2, 100);
  a.execute(command(OP_MIX, 32 << 12 | 0x4000), INPUT << 16 | INPUT - 16);
  expect(a.s16(INPUT - 16)).toBe(150);
  expect(a.s16(INPUT)).toBe(150);
});

test('envelope flags complement samples; F-Zero ignores the complement flags', () => {
  for (const [Audio, expected] of [[NEADAudio, -501], [FZeroAudio, 500]]) {
    const a = fixture(Audio);
    for (let i = 0; i < 16; i++) a.put16(INPUT + i * 2, 1000);
    a.execute(command(OP_SETUP1, 0x800000), 0);
    a.execute(command(OP_SETUP2), 0x80008000);
    a.execute(command(OP_ENVELOPE, INPUT << 12 | 16 << 8 | 2), 0x7090b0d0);
    expect(a.s16(0x700)).toBe(expected);
    expect(a.s16(0x900)).toBe(500);
  }
});

test('FIR averages coefficients for Zelda and saves unfiltered history', () => {
  const a = fixture(OcarinaAudio);
  a.ramView.setInt16(LOOP_STATE, 0x4000);
  a.put16(INPUT, 1000);
  a.execute(command(OP_FILTER, 2 << 16 | VECTOR_BYTES), LOOP_STATE);
  a.execute(command(OP_FILTER, INIT << 16 | INPUT), STATE);
  expect(a.s16(INPUT)).toBe(250); // Initial coefficient is averaged with zero.
  expect(a.ramView.getInt16(STATE)).toBe(1000);
  expect(a.ramView.getInt16(STATE + VECTOR_BYTES)).toBe(0x2000);
  expect(() => a.execute(command(OP_FILTER, INPUT), STATE)).toThrow(UnsupportedAudioCommand);
});

test('F-Zero retains the wet-path test register between consecutive envelopes', () => {
  const a = fixture(FZeroAudio);
  a.execute(command(OP_SETUP1, 0x800002), 0);
  a.execute(command(OP_SETUP2), 0x80008000);
  const envelope = command(OP_ENVELOPE, INPUT << 12 | 16 << 8);
  a.execute(envelope, 0x7090b0d0);
  a.execute(envelope, 0x7090b0d0);
  expect(a.envelopeVolumes[5]).toBe(0x800a);
});

test('invalid DMA addresses fail before touching RAM or the undo journal', () => {
  const a = fixture();
  expect(() => a.dma(INPUT, -8, VECTOR_BYTES, true)).toThrow(UnsupportedAudioCommand);
  expect(a.writeCount).toBe(0);
  expect(a.undoCount).toBe(0);
});
