
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

  n64js.displayWarning = (message) => {
    var $alert = $('<div class="alert"><button class="close" data-dismiss="alert">×</button><strong>Warning!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };
  n64js.displayError = (message) => {
    var $alert = $('<div class="alert alert-error"><button class="close" data-dismiss="alert">×</button><strong>Error!</strong> ' + message + '</div>');
    $('#alerts').append($alert);
  };

}(window.n64js = window.n64js || {}));
