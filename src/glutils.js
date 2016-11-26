
/**
 * A 3 element vector.
 * @param {Float32Array=} opt_elems
 * @constructor
 */
export function Vector3(opt_elems) {
  this.elems = opt_elems || new Float32Array(3);
}

Vector3.prototype = {
  dot(b) {
    var t = 0;
    for (var i = 0; i < this.elems.length; ++i)
      t += this.elems[i]*b.elems[i];
    return t;
  },

  lengthSqr() {
    return this.dot(this);
  },

  length() {
    return Math.sqrt(this.lengthSqr());
  },

  normaliseInPlace() {
    var len = this.length();
    if (len > 0.0) {
      for (var i = 0; i < this.elems.length; ++i)
        this.elems[i] /= len;
    }
    return this;
  },
}

Vector3.create = e => {
  var v = new Vector3();
  v.elems[0] = e[0];
  v.elems[1] = e[1];
  v.elems[2] = e[2];
  return v;
}

/**
 * A 4 element vector.
 * @param {Float32Array=} opt_elems
 * @constructor
 */
export function Vector4(opt_elems) {
  this.elems = opt_elems || new Float32Array(4);
}

Vector4.prototype = {
  dot(b) {
    var t = 0;
    for (var i = 0; i < this.elems.length; ++i)
      t += this.elems[i]*b.elems[i];
    return t;
  },

  lengthSqr() {
    return this.dot(this);
  },

  length() {
    return Math.sqrt(this.lengthSqr());
  },

  normaliseInPlace() {
    var len = this.length();
    if (len > 0.0) {
      for (var i = 0; i < this.elems.length; ++i)
        this.elems[i] /= len;
    }
    return this;
  },
}

Vector4.create = e => {
  var v = new Vector3();
  v.elems[0] = e[0];
  v.elems[1] = e[1];
  v.elems[2] = e[2];
  v.elems[3] = e[3];
  return v;
}
