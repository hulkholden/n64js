function Vector3(elems) {
  this.elems = elems || new Float32Array(3);
}

Vector3.prototype = {

  dot : function (b) {
    var t = 0;
    for (var i = 0; i < this.elems.length; ++i)
      t += this.elems[i]*b.elems[i];
    return t;
  },

  lengthSqr : function () {
    return this.dot(this);
  },

  length : function () {
    return Math.sqrt(this.lengthSqr());
  },

  normaliseInPlace : function () {
    var len = this.length();
    if (len > 0.0) {
      for (var i = 0; i < this.elems.length; ++i)
        this.elems[i] /= len;
    }
    return this;
  },
}

Vector3.create = function (e) {
  var v = new Vector3();
  v.elems[0] = e[0];
  v.elems[1] = e[1];
  v.elems[2] = e[2];
  return v;
}

function Vector4(elems) {
  this.elems = elems || new Float32Array(4);
}

Vector4.prototype = {

  dot : function (b) {
    var t = 0;
    for (var i = 0; i < this.elems.length; ++i)
      t += this.elems[i]*b.elems[i];
    return t;
  },

  lengthSqr : function () {
    return this.dot(this);
  },

  length : function () {
    return Math.sqrt(this.lengthSqr());
  },

  normaliseInPlace : function () {
    var len = this.length();
    if (len > 0.0) {
      for (var i = 0; i < this.elems.length; ++i)
        this.elems[i] /= len;
    }
    return this;
  },

}

Vector4.create = function (e) {
  var v = new Vector3();
  v.elems[0] = e[0];
  v.elems[1] = e[1];
  v.elems[2] = e[2];
  v.elems[3] = e[3];
  return v;
}

function Matrix(elems) {
  this.elems = elems || new Float32Array(16);
}

Matrix.prototype = {

  multiply: function (matrix) {
    var a = this.elems;
    var b = matrix.elems;

    var out = new Float32Array(16);
    for (var r = 0; r < 4; ++r) {
      for (var c = 0; c < 4; ++c) {
        out[r*4 + c] += a[r*4 + 0] * b[0*4 + c];
        out[r*4 + c] += a[r*4 + 1] * b[1*4 + c];
        out[r*4 + c] += a[r*4 + 2] * b[2*4 + c];
        out[r*4 + c] += a[r*4 + 3] * b[3*4 + c];
      }
    }

    return new Matrix(out);
  },

  transformNormal : function (v3_in, v3_out) {
    var a = this.elems;
    var v = v3_in.elems;

    var x = v[0];
    var y = v[1];
    var z = v[2];

    v3_out.elems[0] = (a[0] * x) + (a[1] * y) + (a[ 2] * z);
    v3_out.elems[1] = (a[4] * x) + (a[5] * y) + (a[ 6] * z);
    v3_out.elems[2] = (a[8] * x) + (a[9] * y) + (a[10] * z);
  },

  transformPoint : function (v3_in, v4_out) {

    var a = this.elems;
    var v = v3_in.elems;

    var x = v[0];
    var y = v[1];
    var z = v[2];

    v4_out.elems[0] = (a[ 0] * x) + (a[ 1] * y) + (a[ 2] * z) + a[3];
    v4_out.elems[1] = (a[ 4] * x) + (a[ 5] * y) + (a[ 6] * z) + a[7];
    v4_out.elems[2] = (a[ 8] * x) + (a[ 9] * y) + (a[10] * z) + a[11];
    v4_out.elems[3] = (a[12] * x) + (a[13] * y) + (a[14] * z) + a[15];
  }
}

Matrix.identity = function() {
  var elems = new Float32Array(16);
  elems[0]  = 1;
  elems[5]  = 1;
  elems[10] = 1;
  elems[15] = 1;
  return new Matrix(elems);
}

//
// glOrtho
//
function makeOrtho(left, right, bottom, top, znear, zfar)
{
    var tx = - (right + left) / (right - left);
    var ty = - (top + bottom) / (top - bottom);
    var tz = - (zfar + znear) / (zfar - znear);

    var elems = new Float32Array(16);
/*    elems[0]  = 2 / (right - left);
    elems[1]  = 0;
    elems[2]  = 0;
    elems[3]  = tx;

    elems[4]  = 0;
    elems[5]  = 2 / (top - bottom);
    elems[6]  = 0;
    elems[7]  = ty,

    elems[8]  = 0;
    elems[9]  = 0;
    elems[10] = -2 / (zfar - znear);
    elems[11] = tz;

    elems[12] = 0;
    elems[13] = 0;
    elems[14] = 0;
    elems[15] = 1;
*/
    elems[0]  = 2 / (right - left);
    elems[1]  = 0;
    elems[2]  = 0;
    elems[3]  = 0;

    elems[4]  = 0;
    elems[5]  = 2 / (top - bottom);
    elems[6]  = 0;
    elems[7]  = 0,

    elems[8]  = 0;
    elems[9]  = 0;
    elems[10] = -2 / (zfar - znear);
    elems[11] = 0;

    elems[12] = tx;
    elems[13] = ty;
    elems[14] = tz;
    elems[15] = 1;

    return new Matrix(elems);
}

