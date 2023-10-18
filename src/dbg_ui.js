import GUI from 'lil-gui';

export const dbgGUI = new GUI();
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