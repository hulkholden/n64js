

export class UI {
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

      reader.onerror = e => {
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
    const html = running ? '<i class="glyphicon glyphicon-pause"></i> Pause' : '<i class="glyphicon glyphicon-play"></i> Run';
    $('#runbutton').html(html);
  }
}
