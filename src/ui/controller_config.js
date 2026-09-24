export class ControllerConfig {
  constructor() {
    this.modal = document.getElementById('controller');
    this.modal.querySelectorAll('[data-dialog-close]').forEach(button => {
      button.addEventListener('click', () => this.modal.close());
    });
    // The full-screen dialog surrounds the visible panel, just like the old modal.
    this.modal.addEventListener('click', event => {
      if (event.target === this.modal) this.modal.close();
    });
    // Keep Tab cycling within the controls instead of moving to browser chrome.
    this.modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...this.modal.querySelectorAll('button, input')]
        .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    this.modal.addEventListener('close', () => {
      document.body.classList.remove('modal-open');
    });
    this.initKeyInputs();
  }

  show() {
    this.modal.showModal();
    document.body.classList.add('modal-open');
  }

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
