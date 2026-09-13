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

const scriptButtons = {
  A: 0x8000, B: 0x4000, Z: 0x2000, START: 0x1000,
  UP: 0x0800, DOWN: 0x0400, LEFT: 0x0200, RIGHT: 0x0100,
  L: 0x0020, R: 0x0010, C_UP: 0x0008, C_DOWN: 0x0004, C_LEFT: 0x0002, C_RIGHT: 0x0001,
};

export const inputScriptHelp = `Input scripts are JSON: {"version":1,"steps":[{"frames":120},
{"frames":1,"buttons":["START"]},{"frames":59},{"frames":1,"buttons":["A"]}]}.
Each step holds a complete controller-1 state for that many VIs, starting at VI 1.
Omitted buttons/stickX/stickY are neutral. Buttons (case insensitive):
A, B, Z, START, UP, DOWN, LEFT, RIGHT, L, R, C_UP, C_DOWN, C_LEFT, C_RIGHT.
Stick axes are integers from -128 to 127; positive X is right, positive Y is up.
After the last step, seeded random input starts at the beginning of its sequence.
The frame limit includes the script. Reports embed the script for replay.`;

function checkKeys(value, keys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`Invalid input script ${context}`);
  }
}

export function parseInputScript(script) {
  checkKeys(script, ['version', 'steps'], 'object');
  if (script.version !== 1 || !Array.isArray(script.steps) || !script.steps.length) {
    throw new Error('Input script requires version 1 and a nonempty steps array');
  }
  let frames = 0;
  const steps = script.steps.map((step, index) => {
    const context = `step ${index + 1}`;
    checkKeys(step, ['frames', 'buttons', 'stickX', 'stickY'], context);
    frames += step.frames;
    if (!Number.isSafeInteger(step.frames) || step.frames < 1 || !Number.isSafeInteger(frames)) {
      throw new Error(`Invalid input script ${context} duration`);
    }
    const buttons = step.buttons === undefined ? [] : step.buttons;
    if (!Array.isArray(buttons) || buttons.some(button => typeof button !== 'string' || !Object.hasOwn(scriptButtons, button.toUpperCase()))) {
      throw new Error(`Invalid input script ${context} buttons`);
    }
    const stickX = step.stickX === undefined ? 0 : step.stickX;
    const stickY = step.stickY === undefined ? 0 : step.stickY;
    if (![stickX, stickY].every(value => Number.isInteger(value) && value >= -128 && value <= 127)) {
      throw new Error(`Invalid input script ${context} stick position`);
    }
    return { frames: step.frames, buttons: [...new Set(buttons.map(button => button.toUpperCase()))].sort(), stickX, stickY };
  });
  return { version: 1, steps };
}

// The script is validated and embedded in settings before starting a worker.
// Offset the random driver's VI counter so prefix length cannot change its stream.
export function createInputDriver(seed, script) {
  const randomInput = createRandomInputDriver(seed);
  if (!script) return randomInput;
  const steps = script.steps.map(step => ({
    frames: step.frames,
    input: {
      buttons: step.buttons.reduce((mask, button) => mask | scriptButtons[button], 0),
      stick_x: step.stickX, stick_y: step.stickY,
    },
  }));
  let index = 0;
  let elapsed = 0;
  return (frame, input) => {
    while (index < steps.length && frame > elapsed + steps[index].frames) elapsed += steps[index++].frames;
    if (index < steps.length) Object.assign(input, steps[index].input);
    else randomInput(frame - elapsed, input);
  };
}

// Called once per VI, starting at frame 1. Hold an action for 8–24 VIs, then
// release everything until the next 60-VI slot. Weight Start/A to navigate menus.
function createRandomInputDriver(seed) {
  const random = createRandom(seed ^ 0x9e3779b9);
  const buttons = [0x1000, 0x8000, 0x8000, 0x8000, 0x4000, 0x2000, 0, 0];
  const sticks = [-80, 0, 80];
  let releaseAt = 0;
  return (frame, input) => {
    const phase = (frame - 1) % 60;
    if (phase === 0) {
      releaseAt = 8 + Math.floor(random() * 17);
      input.buttons = buttons[Math.floor(random() * buttons.length)];
      input.stick_x = sticks[Math.floor(random() * sticks.length)];
      input.stick_y = sticks[Math.floor(random() * sticks.length)];
      if (input.buttons === 0x1000 || random() < 0.5) {
        input.stick_x = 0;
        input.stick_y = 0;
      }
    } else if (phase === releaseAt) {
      input.buttons = 0;
      input.stick_x = 0;
      input.stick_y = 0;
    }
  };
}
