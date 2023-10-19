import * as bootstrap from 'bootstrap';

export class ControllerConfig {
  constructor() {
    this.modal = new bootstrap.Modal('#controller', {});
  }

  show() { this.modal.show(); }
}
