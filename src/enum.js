import { toString32 } from "./format.js";

/**
 * Adds a nameOf function to the provided Object so that we can easily find the
 * name for a given value. e.g.:
 *     var name = Foo.nameOf(fooValue);
 * @param {!Object<string, number>} values
 * @return {!Object<string, number>}
 */
export function makeEnum(values) {
  values.nameOf = value => {
    for (let name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name) && values[name] === value) {
        return name;
      }
    }
    return toString32(value);
  };

  return Object.freeze(values);
}
