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

// Bind all controls before restoring this folder, regardless of when it is added.
export function addOptionsFolder(name, bindOptions) {
  const folder = dbgGUI.addFolder(name);
  bindOptions(folder);
  if (typeof document === 'undefined') return;

  const storageKey = `n64js-debug-options:${name}`;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) folder.load(JSON.parse(saved));
  } catch {
    // Ignore unavailable storage or unreadable saved data.
  }

  folder.onChange(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(folder.save()));
    } catch {
      // Options still work when storage is blocked or full.
    }
  });
}

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
