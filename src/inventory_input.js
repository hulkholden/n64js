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

// Called once per VI, starting at frame 1. Hold an action for 8–24 VIs, then
// release everything until the next 60-VI slot. Weight Start/A to navigate menus.
export function createInputDriver(seed) {
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
