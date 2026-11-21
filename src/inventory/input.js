import { isPlainObject } from './schema.js';

const MIN_STICK_AXIS = -128;
const MAX_STICK_AXIS = 127;

const BUTTONS = {
  A: 0x8000, B: 0x4000, Z: 0x2000, START: 0x1000,
  UP: 0x0800, DOWN: 0x0400, LEFT: 0x0200, RIGHT: 0x0100,
  L: 0x0020, R: 0x0010, C_UP: 0x0008, C_DOWN: 0x0004, C_LEFT: 0x0002, C_RIGHT: 0x0001,
};

const RANDOM_INPUT_SEED_MASK = 0x9e3779b9;
const RANDOM_SLOT_FRAMES = 60;
const RANDOM_MIN_HOLD_FRAMES = 8;
const RANDOM_HOLD_SPAN = 17; // 8–24 VIs inclusive
const RANDOM_STICK_LEVELS = [-80, 0, 80];
// Weight Start/A to navigate menus.
const RANDOM_BUTTON_POOL = [
  BUTTONS.START,
  BUTTONS.A,
  BUTTONS.A,
  BUTTONS.A,
  BUTTONS.B,
  BUTTONS.Z,
  0,
  0,
];

// Mulberry32: keep CPU randomness and controller randomness on separate streams.
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

// Bump this version when changing the input sequence for a given seed.
export const inputPolicy = { name: 'random-controller', version: 1 };

export const inputScriptHelp = `Input scripts are JSON: {"version":1,"steps":[{"frames":120},
{"frames":1,"buttons":["START"]},{"frames":59},{"frames":1,"buttons":["A"]}]}.
Each step holds a complete controller-1 state for that many VIs, starting at VI 1.
Omitted buttons/stickX/stickY are neutral. Buttons (case insensitive):
A, B, Z, START, UP, DOWN, LEFT, RIGHT, L, R, C_UP, C_DOWN, C_LEFT, C_RIGHT.
Stick axes are integers from -128 to 127; positive X is right, positive Y is up.
After the last step, seeded random input starts at the beginning of its sequence.
The frame limit includes the script. Reports embed the script for replay.`;

function assertAllowedKeys(value, allowedKeys, context) {
  if (!isPlainObject(value) || Object.keys(value).some(key => !allowedKeys.includes(key))) {
    throw new Error(`Invalid input script ${context}`);
  }
}

function isValidStickAxis(value) {
  return Number.isInteger(value) && value >= MIN_STICK_AXIS && value <= MAX_STICK_AXIS;
}

function parseScriptButtons(rawButtons, context) {
  const buttons = rawButtons === undefined ? [] : rawButtons;
  if (!Array.isArray(buttons)) {
    throw new Error(`Invalid input script ${context} buttons`);
  }
  const normalized = new Set();
  for (const button of buttons) {
    if (typeof button !== 'string') {
      throw new Error(`Invalid input script ${context} buttons`);
    }
    const name = button.toUpperCase();
    if (!Object.hasOwn(BUTTONS, name)) {
      throw new Error(`Invalid input script ${context} buttons`);
    }
    normalized.add(name);
  }
  return [...normalized].sort();
}

function parseScriptStep(step, index, priorFrames) {
  const context = `step ${index + 1}`;
  assertAllowedKeys(step, ['frames', 'buttons', 'stickX', 'stickY'], context);

  const totalFrames = priorFrames + step.frames;
  if (!Number.isSafeInteger(step.frames) || step.frames < 1 || !Number.isSafeInteger(totalFrames)) {
    throw new Error(`Invalid input script ${context} duration`);
  }

  const buttons = parseScriptButtons(step.buttons, context);
  const stickX = step.stickX === undefined ? 0 : step.stickX;
  const stickY = step.stickY === undefined ? 0 : step.stickY;
  if (!isValidStickAxis(stickX) || !isValidStickAxis(stickY)) {
    throw new Error(`Invalid input script ${context} stick position`);
  }

  return {
    step: { frames: step.frames, buttons, stickX, stickY },
    totalFrames,
  };
}

export function parseInputScript(script) {
  assertAllowedKeys(script, ['version', 'steps'], 'object');
  if (script.version !== 1 || !Array.isArray(script.steps) || !script.steps.length) {
    throw new Error('Input script requires version 1 and a nonempty steps array');
  }
  let totalFrames = 0;
  const steps = script.steps.map((rawStep, index) => {
    const parsed = parseScriptStep(rawStep, index, totalFrames);
    totalFrames = parsed.totalFrames;
    return parsed.step;
  });
  return { version: 1, steps };
}

function compileScriptStep(step) {
  return {
    frames: step.frames,
    input: {
      buttons: step.buttons.reduce((mask, button) => mask | BUTTONS[button], 0),
      stick_x: step.stickX,
      stick_y: step.stickY,
    },
  };
}

// The script is validated and embedded in settings before starting a worker.
// Offset the random driver's VI counter so prefix length cannot change its stream.
export function createInputDriver(seed, script) {
  const randomInput = createRandomInputDriver(seed);
  if (!script) {
    return randomInput;
  }
  const steps = script.steps.map(compileScriptStep);
  let index = 0;
  let elapsed = 0;
  return (frame, input) => {
    while (index < steps.length && frame > elapsed + steps[index].frames) {
      elapsed += steps[index++].frames;
    }
    if (index < steps.length) {
      Object.assign(input, steps[index].input);
    } else {
      randomInput(frame - elapsed, input);
    }
  };
}

function resetController(input) {
  input.buttons = 0;
  input.stick_x = 0;
  input.stick_y = 0;
}

// Called once per VI, starting at frame 1. Hold an action for 8–24 VIs, then
// release everything until the next 60-VI slot.
function createRandomInputDriver(seed) {
  const random = createRandom(seed ^ RANDOM_INPUT_SEED_MASK);
  let releaseAt = 0;
  return (frame, input) => {
    const phase = (frame - 1) % RANDOM_SLOT_FRAMES;
    if (phase === 0) {
      releaseAt = RANDOM_MIN_HOLD_FRAMES + Math.floor(random() * RANDOM_HOLD_SPAN);
      input.buttons = RANDOM_BUTTON_POOL[Math.floor(random() * RANDOM_BUTTON_POOL.length)];
      input.stick_x = RANDOM_STICK_LEVELS[Math.floor(random() * RANDOM_STICK_LEVELS.length)];
      input.stick_y = RANDOM_STICK_LEVELS[Math.floor(random() * RANDOM_STICK_LEVELS.length)];
      if (input.buttons === BUTTONS.START || random() < 0.5) {
        input.stick_x = 0;
        input.stick_y = 0;
      }
    } else if (phase === releaseAt) {
      resetController(input);
    }
  };
}
