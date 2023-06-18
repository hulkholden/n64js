
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
        n64js.displayWarning('error loading file');
      };
      reader.onload = e => {
        n64js.loadRomAndStartRunning(e.target.result);
      };

      reader.readAsArrayBuffer(file);
    }
  };
}(window.n64js = window.n64js || {}));
