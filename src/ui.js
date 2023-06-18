
(function (n64js) {
  'use strict';

  n64js.triggerLoad = () => {
    const $fileinput = $('#fileInput');
    // Reset fileInput value, otherwise onchange doesn't recognise when we select the same rome back-to-back
    $fileinput.val('');
    $fileinput.click();
  };

  n64js.loadFile = () => {
    const f = document.getElementById("fileInput");
    if (f && f.files.length > 0) {
      const file = f.files[0];
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
