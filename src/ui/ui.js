/*global n64js*/

import { Tab } from 'bootstrap';
import { ControllerConfig } from "./controller_config.js";

export class UI {
  constructor() {
    this.controllerConfig = null;
  }

  domLoaded() {
    this.controllerConfig = new ControllerConfig();

    const dbg = n64js.debugger();

    // Make sure that the tabs refresh when clicked.
    document.querySelectorAll('.tabbable a').forEach(tab => {
      tab.addEventListener('shown.bs.tab', () => { dbg.redraw(); });
    });

    document.getElementById('info-toggle').addEventListener('click', event => {
      event.preventDefault();
      const info = document.getElementById('info');
      info.hidden = !info.hidden;
    });

    dbg.redraw();
  }

  showTab(id) {
    Tab.getOrCreateInstance(document.getElementById(id)).show();
  }

  toggleControllerConfig() {
    this.controllerConfig.show();
  }

  triggerLoad() {
    const fileInput = document.getElementById("fileInput");
    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    fileInput.value = '';
    fileInput.click();
  }

  loadFile() {
    const fileInput = document.getElementById("fileInput");
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const reader = new FileReader();

      reader.onerror = () => {
        this.displayError('loading file');
      };
      reader.onload = e => {
        n64js.loadRomAndStartRunning(e.target.result);
      };
      reader.readAsArrayBuffer(file);
    }
  }

  displayWarning(message) { this.displayAlert("Warning", message); }
  displayError(message) { this.displayAlert("Error", message); }

  displayAlert(alertType, message) {
    const tmpl = document.getElementById("alert");
    const node = tmpl.content.cloneNode(true);
    const typeSpan = node.querySelector(".alert-type");
    const messageSpan = node.querySelector(".alert-message");

    typeSpan.textContent = alertType + "!";
    messageSpan.textContent = message;

    document.getElementById('alerts').append(node);
  }

  setRunning(running) {
    const html = running ? '<i class="bi-pause"></i> Pause' : '<i class="bi-play"></i> Run';
    document.getElementById('runbutton').innerHTML = html;
  }
}
