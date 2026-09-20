
/**
 * @type {?HTMLElement} The element to write output to.
 */
let outputElement;

/**
 * @type {function(): string} A function to return a prefix for the log line.
 */
let getPrefixFn;

/**
 * Initialise the logger.
 * @param {?HTMLElement} output The element to append output to.
 * @param {!function(): string} prefix The function to call to generate the
 *     prefix for log lines.
 */
export function initialise(output, prefix) {
  outputElement = output;
  getPrefixFn = prefix;
}

/**
 * Clears the log output.
 */
export function clear() {
  if (outputElement) {
    outputElement.replaceChildren();
  }
}

/**
 * Logs a string, preserving embedded HTML formatting.
 * @param {string} str
 */
export function log(str) {
  if (getPrefixFn) {
    str = `${getPrefixFn()}: ${str}`;
  }
  console.log(str);
  if (outputElement) {
    outputElement.insertAdjacentHTML('beforeend', `${str}<br>`);
    outputElement.scrollTop = outputElement.scrollHeight;
  }
}

/**
 * Logs a string as a warning, preserving embedded HTML formatting.
 * @param {string} str
 */
export function warn(str) {
  if (getPrefixFn) {
    str = `${getPrefixFn()}: ${str}`;
  }
  console.warn(str);
  if (outputElement) {
    outputElement.insertAdjacentHTML('beforeend', `<span style="color: yellow">${str}</span><br>`);
    outputElement.scrollTop = outputElement.scrollHeight;
  }
}

/**
 * Appends an HTML element to the log.
 * @param {!Node} html
 */
export function logHTML(html) {
  if (outputElement) {
    outputElement.append(html);
  }
}
