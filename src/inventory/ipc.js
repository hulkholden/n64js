// A successful send() return does not mean IPC has flushed. Await each callback
// to bound queued checkpoints, and await the terminal report before disconnect.
export function sendInventoryUpdate(update) {
  return new Promise((resolve, reject) => {
    process.send(update, error => error ? reject(error) : resolve());
  });
}
