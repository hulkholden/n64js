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

// Call once all options have been added so folder and controller names match.
export function initPersistence() {
  if (typeof document === 'undefined') return;

  const storageKey = 'n64js-debug-options';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) dbgGUI.load(JSON.parse(saved));
  } catch {
    // Ignore unavailable storage or unreadable saved data.
  }

  dbgGUI.onChange(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(dbgGUI.save()));
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
