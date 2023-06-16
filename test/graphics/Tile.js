import { Tile } from "../../src/graphics/Tile.js";

const assert = require('chai').assert;

describe('Tile', () => {
  var tile;
  beforeEach(function () {
    tile = new Tile();
  });

  describe('constructor', () => {
    it('should initialize members', () => {
      assert.equal(-1, tile.format);
      assert.equal(0, tile.size);
      assert.equal(0, tile.line);
      assert.equal(0, tile.tmem);
      assert.equal(0, tile.palette);
      assert.equal(0, tile.cm_t);
      assert.equal(0, tile.mask_t);
      assert.equal(0, tile.shift_t);
      assert.equal(0, tile.cm_s);
      assert.equal(0, tile.mask_s);
      assert.equal(0, tile.shift_s);
      assert.equal(0, tile.uls);
      assert.equal(0, tile.ult);
      assert.equal(0, tile.lrs);
      assert.equal(0, tile.lrt);
      assert.equal(0, tile.hash);
    });
  });
  describe('coordinate properties', () => {
    it('should use uls,ult,lrs,lrt', () => {
      tile.uls = 5;
      tile.ult = 6;
      tile.lrs = 7;
      tile.lrt = 8;
      assert.equal(1.25, tile.left);
      assert.equal(1.5, tile.top);
      assert.equal(1.75, tile.right);
      assert.equal(2, tile.bottom);
    });
  });
  describe('dimension properties', () => {
    it('should be at least 1', () => {
      tile.uls = 0;
      tile.ult = 0;
      tile.lrs = 0;
      tile.lrt = 0;
      assert.equal(1, tile.width);
      assert.equal(1, tile.height);
    });
    it('should use uls,ult,lrs,lrt', () => {
      tile.uls = 5;
      tile.ult = 102;
      tile.lrs = 9;
      tile.lrt = 108;
      assert.equal(2.0, tile.width);
      assert.equal(2.5, tile.height);
    });
    it('should use mask_s to compute width', () => {
      tile.uls = 0;
      tile.lrs = 100;

      let results = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => {
        tile.mask_s = mask;
        return tile.width;
      });
      assert.deepEqual([26, 2, 4, 8, 16, 26, 26, 26], results);
    });
    it('should use mask_t to compute height', () => {
      tile.ult = 0;
      tile.lrt = 200;

      let results = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => {
        tile.mask_t = mask;
        return tile.height;
      });
      assert.deepEqual([51, 2, 4, 8, 16, 32, 51, 51], results);
    });
  });
});
