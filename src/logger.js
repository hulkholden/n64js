
/**
 * @type {jQuery} The element to write output to.
 */
let outputElement;

/**
 * @type {function(): string} A function to return a prefix for the log line.
 */
let getPrefixFn;

/**
 * Initialise the logger.
 * @param {!jQuery} output The element to append output to.
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
    outputElement.html('');
  }
}

/**
 * Logs a string.
 * @param {string} str
 */
export function log(str) {
  if (getPrefixFn) {
    str = `${getPrefixFn()}: ${str}`;
  }
  console.log(str);
  if (outputElement) {
    outputElement.append(`${str}<br>`);
    outputElement.scrollTop(outputElement[0].scrollHeight);
  }
}

/**
 * Logs a string as a warning.
 * @param {string} str
 */
export function warn(str) {
  if (getPrefixFn) {
    str = `${getPrefixFn()}: ${str}`;
  }
  console.warn(str);
  if (outputElement) {
    outputElement.append(`<font color="yellow">${str}</font><br>`);
    outputElement.scrollTop(outputElement[0].scrollHeight);
  }
}

/**
 * Appends an HTML element to the log.
 * @param {jQuery} html
 */
export function logHTML(html) {
  if (outputElement) {
    outputElement.append(html);
  }
}
