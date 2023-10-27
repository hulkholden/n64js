/*global $, n64js*/

import { ControllerConfig } from "./controller_config.js";

export class UI {
  constructor() {
    this.controllerConfig = null;
  }

  domLoaded() {
    this.controllerConfig = new ControllerConfig();

    const dbg = n64js.debugger();

    // const body = document.querySelector('body');
    // body.addEventListener('keypress', (event) => {
    //   switch (event.key) {
    //     case 'o': $('#output-tab').tab('show'); break;
    //     case 'd': $('#cpu-tab').tab('show'); break;
    //     case 'm': $('#memory-tab').tab('show'); break;
    //     case 'l': n64js.ui().triggerLoad();     break;
    //     case 'g': n64js.toggleRun();            break;
    //     case 's': n64js.step();                 break;
    //   }
    // });

    // Make sure that the tabs refresh when clicked
    $('.tabbable a').on('shown.bs.tab', () => { dbg.redraw(); });

    dbg.redraw();
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

    $('#alerts').append(node);
  }

  setRunning(running) {
    const html = running ? '<i class="bi-pause"></i> Pause' : '<i class="bi-play"></i> Run';
    $('#runbutton').html(html);
  }
}
