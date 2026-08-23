import GUI from 'lil-gui';

class HeadlessGUI {
  addFolder() { return this; }
  add() { return this; }
  name() { return this; }
  min() { return this; }
  max() { return this; }
  step() { return this; }
  title() {}
  hide() {}
  show() {}
}

export const dbgGUI = typeof document === 'undefined' ? new HeadlessGUI() : new GUI();
dbgGUI.title('Options');

dbgGUI.hide();

export function show() {
  dbgGUI.show();
}

export function hide() {
  dbgGUI.hide();
}

export function setVisible(value) {
  if (value) {
    show();
  } else {
    hide();
  }
}
