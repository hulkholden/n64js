/*global n64js*/

// An exception thrown when an assert fails.
export class AssertException {
  constructor(message) {
    this.message = message;
  }
  toString() {
    return 'AssertException: ' + this.message;
  }
}

export function assert(e, m) {
  if (!e) {
    throw new AssertException(m);
  }
}

// Expose to dynarec.
window.n64js = window.n64js || {};
n64js.assert = (cond, msg) => {
  assert(cond, msg);
};
