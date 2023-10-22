
// N64 Controller button values.
const kButtonA = 0x8000;
const kButtonB = 0x4000;
const kButtonZ = 0x2000;
const kButtonStart = 0x1000;
const kButtonJUp = 0x0800;
const kButtonJDown = 0x0400;
const kButtonJLeft = 0x0200;
const kButtonJRight = 0x0100;

const kButtonL = 0x0020;
const kButtonR = 0x0010;
const kButtonCUp = 0x0008;
const kButtonCDown = 0x0004;
const kButtonCLeft = 0x0002;
const kButtonCRight = 0x0001;

// Gamepad API button values.
// Right cluster.
const kGamepadAPIRightBottom = 0;
const kGamepadAPIRightRight = 1;
const kGamepadAPIRightLeft = 2;
const kGamepadAPIRightTop = 3;
// Top cluster.
const kGamepadAPITopLeft = 4;
const kGamepadAPITopRight = 5;
const kGamepadAPIBottomLeft = 6;
const kGamepadAPIBottomRight = 7;
// Center cluster.
const kGamepadAPICenterLeft = 8;
const kGamepadAPICenterRight = 9;
// Sticks.
const kGamepadAPILeftStick = 10;
const kGamepadAPIRightStick = 11;
// Left cluster.
const kGamepadAPILeftTop = 12;
const kGamepadAPILeftBottom = 13;
const kGamepadAPILeftLeft = 14;
const kGamepadAPILeftRight = 15;
// Center cluster (again).
const kGamepadAPICenterCenter = 16;

const kGamepadAPINumButtons = 17;

// Gamepad API axes values.
const kGamepadAPIAxisLeftX = 0; // neg left, pos right.
const kGamepadAPIAxisLeftY = 1; // neg up, pos down.
const kGamepadAPIAxisRightX = 2; // neg left, pos right.
const kGamepadAPIAxisRightY = 3; // neg up, pos down.

const kGamepadAPINumAxes = 4;

export class ControllerInputs {
  constructor() {
    this.buttons = 0;
    this.stick_x = 0;
    this.stick_y = 0;
  }
}

export class Controllers {
  constructor() {
    this.inputs = [
      new ControllerInputs(),
      new ControllerInputs(),
      new ControllerInputs(),
      new ControllerInputs(),
    ];
    const body = document.querySelector('body');
    body.addEventListener('keyup', (event) => {
      this.handleKey(0, event.key, false);
    });
    body.addEventListener('keydown', (event) => {
      this.handleKey(0, event.key, true);
    });

    this.gamepads = {};
    this.activeGamepadidx = -1;
    window.addEventListener("gamepadconnected", e => { this.connectGamepad(e) }, false);
    window.addEventListener("gamepaddisconnected", e => { this.disconnectGamepad(e) }, false);

    this.controllerMapping = new ControllerMapping();
  }

  handleKey(idx, key, down) {
    // TODO: if the user interacts via the keyboard, disable the gamepad (and vice versa).
    switch (key) {
      case 'a': this.setButton(idx, kButtonStart, down); break;
      case 's': this.setButton(idx, kButtonA, down); break;
      case 'x': this.setButton(idx, kButtonB, down); break;
      case 'z': this.setButton(idx, kButtonZ, down); break;
      case 'y': this.setButton(idx, kButtonZ, down); break;
      case 'c': this.setButton(idx, kButtonL, down); break;
      case 'v': this.setButton(idx, kButtonR, down); break;

      case 't': this.setButton(idx, kButtonJUp, down); break;
      case 'g': this.setButton(idx, kButtonJDown, down); break;
      case 'f': this.setButton(idx, kButtonJLeft, down); break;
      case 'h': this.setButton(idx, kButtonJRight, down); break;

      case 'i': this.setButton(idx, kButtonCUp, down); break;
      case 'k': this.setButton(idx, kButtonCDown, down); break;
      case 'j': this.setButton(idx, kButtonCLeft, down); break;
      case 'l': this.setButton(idx, kButtonCRight, down); break;

      case 'ArrowLeft': this.setStickX(idx, down ? -80 : 0); break;
      case 'ArrowRight': this.setStickX(idx, down ? +80 : 0); break;
      case 'ArrowDown': this.setStickY(idx, down ? -80 : 0); break;
      case 'ArrowUp': this.setStickY(idx, down ? +80 : 0); break;
      // default: console.log(`unhandled key: ${key}`);
    }
  }

  setStickX(idx, val) { this.inputs[idx].stick_x = val; }
  setStickY(idx, val) { this.inputs[idx].stick_y = val; }
  setButton(idx, button, down) {
    let buttons = this.inputs[idx].buttons;
    if (down) {
      buttons |= button;
    } else {
      buttons &= ~button;
    }
    this.inputs[idx].buttons = buttons;
  }

  connectGamepad(event) {
    const gp = event.gamepad;
    console.log(`Gamepad connected at index ${gp.index}: ${gp.id}. ${gp.buttons.length} buttons, ${gp.axes.length} axes.`);
    this.gamepads[gp.index] = gp;

    if (this.activeGamepadidx < 0) {
      if (this.isStandardGamepad(gp)) {
        this.activeGamepadidx = gp.index;
      } else {
        console.log(`Gamepad mapping is non-standard, ignoring`);
      }
    }
  }

  disconnectGamepad(event) {
    const gp = event.gamepad;
    delete this.gamepads[gp.index];
    if (gp.index == this.activeGamepadidx) {
      this.activeGamepadidx = -1;
    }
  }

  isStandardGamepad(gp) {
    if (gp.mapping !== 'standard') {
      console.log(`gamepad mapping is unhandled: (${gp.mapping})`);
      return false;
    }
    if (gp.axes.length < kGamepadAPINumAxes) {
      console.log(`gamepad has too few axes: ${gp.axes.length} < ${kGamepadAPINumAxes}`);
      return false;
    }
    if (gp.buttons.length < kGamepadAPINumButtons) {
      console.log(`gamepad has too few buttons: ${gp.buttons.length} < ${kGamepadAPINumButtons}`);
      return false;
    }
    if (typeof gp.buttons[0] !== "object") {
      console.log('gamepad buttons element is not object');
      return false;
    }
    return true;
  }

  updateInput() {
    if (this.activeGamepadidx < 0) {
      return;
    }
    const gp = navigator.getGamepads()[this.activeGamepadidx];
    if (!gp.connected) {
      console.log('gamepad not connected');
      return;
    }

    const btns = gp.buttons;
    this.controllerMapping.mappings.forEach((mapping, n64button) => {
      const mod = mapping.gpModifier === undefined ? true : btns[mapping.gpModifier].pressed == mapping.gpModifierDown;
      if (mod) {
        this.setButton(0, n64button, btns[mapping.gpButton].pressed);
      }
    });

    this.setStickX(0, gp.axes[kGamepadAPIAxisLeftX] * 80);
    this.setStickY(0, gp.axes[kGamepadAPIAxisLeftY] * -80);
  }
}

class ControllerMapping {
  constructor() {
    const m = new Map();
    this.mappings = m;

    // If the ltrigger is pressed interpret the face buttons as CButtons.
    m.set(kButtonCUp, new ButtonMapping(kGamepadAPIRightTop, kGamepadAPIBottomLeft, true));
    m.set(kButtonCDown, new ButtonMapping(kGamepadAPIRightBottom, kGamepadAPIBottomLeft, true));
    m.set(kButtonCLeft, new ButtonMapping(kGamepadAPIRightLeft, kGamepadAPIBottomLeft, true));
    m.set(kButtonCRight, new ButtonMapping(kGamepadAPIRightRight, kGamepadAPIBottomLeft, true));
    // Default commands when the ltrigger is not pressed.
    m.set(kButtonA, new ButtonMapping(kGamepadAPIRightBottom, kGamepadAPIBottomLeft, false));
    m.set(kButtonB, new ButtonMapping(kGamepadAPIRightRight, kGamepadAPIBottomLeft, false));

    m.set(kButtonL, new ButtonMapping(kGamepadAPITopLeft));
    m.set(kButtonR, new ButtonMapping(kGamepadAPITopRight));
    m.set(kButtonStart, new ButtonMapping(kGamepadAPICenterRight));
    m.set(kButtonZ, new ButtonMapping(kGamepadAPIBottomRight));

    m.set(kButtonJUp, new ButtonMapping(kGamepadAPILeftTop));
    m.set(kButtonJDown, new ButtonMapping(kGamepadAPILeftBottom));
    m.set(kButtonJLeft, new ButtonMapping(kGamepadAPILeftLeft));
    m.set(kButtonJRight, new ButtonMapping(kGamepadAPILeftRight));
  }
}

class ButtonMapping {
  constructor(gpButton, opt_gpModifier, opt_gpModifierDown) {
    this.gpButton = gpButton;
    this.gpModifier = opt_gpModifier;
    this.gpModifierDown = opt_gpModifierDown;
  }
}
