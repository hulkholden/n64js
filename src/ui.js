
(function (n64js) {
  'use strict';

  n64js.triggerLoad = () => {
    const fileInput = document.getElementById("fileInput");
    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    fileInput.value = '';
    fileInput.click();
  };

  n64js.loadFile = () => {
    const fileInput = document.getElementById("fileInput");
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const reader = new FileReader();

      reader.onerror = e => {
        n64js.displayError('loading file');
      };
      reader.onload = e => {
        n64js.loadRomAndStartRunning(e.target.result);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  n64js.displayWarning = (message) => { displayAlert("Warning", message); };
  n64js.displayError = (message) => { displayAlert("Error", message); };

  function displayAlert(alertType, message) {
    const tmpl = document.getElementById("alert");
    const node = tmpl.content.cloneNode(true);
    const typeSpan = node.querySelector(".alert-type");
    const messageSpan = node.querySelector(".alert-message");

    typeSpan.textContent = alertType + "!";
    messageSpan.textContent = message;
    
    $('#alerts').append(node);
  };


}(window.n64js = window.n64js || {}));
