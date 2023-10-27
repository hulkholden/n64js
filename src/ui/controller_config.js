import * as bootstrap from 'bootstrap';

export class ControllerConfig {
  constructor() {
    this.modal = new bootstrap.Modal('#controller', {});
    this.initKeyInputs();
  }

  show() { this.modal.show(); }

  initKeyInputs() {
    const elems = document.querySelectorAll('.control-input');
    elems.forEach(elem => {
      elem.addEventListener('keydown', event => {
        if (this.handleKeyDown(elem, event)) {
          event.preventDefault();
          return false;
        }
      });
      elem.addEventListener('input', () => {
        // TODO: figure out what to do here (copy, paste, etc).
      });
    })
  }

  handleKeyDown(elem, event) {
    if (event.key.length == 1 && !event.metaKey && !event.ctrlKey) {
      elem.value = event.key.toLowerCase();
      return true;
    }
  }
}
