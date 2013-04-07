var http = require('http');
var fs   = require('fs');
var path = require('path');
var tty  = require("tty");
var url  = require("url");

var sync_fd = fs.openSync('./sync.bin', 'a+');

http.createServer(function (request, response) {
  console.log(request.url);

  var parsed = url.parse(request.url, true);

  if (parsed.pathname === '/rsynclog') {
    readSyncLog(parsed.query.o, parsed.query.l, request, response);
    return;
  } else if (parsed.pathname === '/wsynclog') {
    if (request.method === 'POST') {
      writeSyncLog(parsed.query.o, parsed.query.l, request, response);
    } else {
      response.writeHead(500);
      response.end();
    }
    return;
  }

  serveFile(request, response);

}).listen(8124);

console.log('Server running at http://127.0.0.1:8124/');

// process.openStdin().on("keypress", function(chunk, key) {
//   if(key && key.name === "c" && key.ctrl) {
//     console.log("Got ctrl-c - exiting");
//     process.exit();
//   }
// });

// process.stdin.setRawMode(true);

process.on( 'SIGINT', function() {
  console.log("Got ctrl-c - exiting");
  process.exit();
});

function readSyncLog(offset, length, request, response) {
  offset = parseInt(offset, 10) || 0;
  length = parseInt(length, 10) || 1024;

  var buffer = new Buffer(length);

  fs.readSync(sync_fd, buffer, 0, length, offset);
  response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  response.end(buffer, 'utf-8');
}

function writeSyncLog(offset, length, request, response) {
  offset = parseInt(offset, 10) || 0;
  length = parseInt(length, 10) || 1024;

  var data = [], dataLen = 0;

  request.on('data', function(chunk) {
    data.push(chunk);
    dataLen += chunk.length;
  });
  request.on('end', function() {
    var buffer = new Buffer(dataLen);
    for (var i=0,len=data.length,pos=0; i<len; i++) {
      data[i].copy(buffer, pos);
      pos += data[i].length;
    }
    fs.writeSync(sync_fd, buffer, 0, dataLen, offset);
    fs.truncateSync(sync_fd, offset + dataLen);

    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('OK', 'utf-8');
  });
}

function serveFile(request, response) {

  var filePath = '.' + request.url;

  var extname = path.extname(filePath);
  var contentType;
  switch (extname) {
    case '.html':
      contentType = 'text/html';
      break;
    case '.js':
      contentType = 'application/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.map':
      contentType = 'text/plain';
      break;
  }

  // Only serve filetype we know about
  if(!contentType) {
      response.writeHead(404);
      response.end();
  }

  fs.exists(filePath, function(exists) {
    if (exists) {
      fs.readFile(filePath, function(error, content) {
        if (error) {
          response.writeHead(500);
          response.end();
        } else {
          response.writeHead(200, { 'Content-Type': contentType });
          response.end(content, 'utf-8');
        }
      });
    } else {
      response.writeHead(404);
      response.end();
    }
  });
}
