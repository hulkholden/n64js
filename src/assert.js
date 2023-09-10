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
