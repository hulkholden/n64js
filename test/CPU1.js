import { CPU1 } from '../src/CPU1.js';

const assert = require('chai').assert;

describe('CPU1', () => {
  var cpu;
  beforeEach(function () {
    cpu = new CPU1();
  });

  describe('constructor', () => {
    it('should alias registers', () => {
      cpu.float64[0] = 1.0;

      // The actual values aren't important, we just want to check the memory
      // is aliased correctly between all the arrays.
      assert.equal(0, cpu.float32[0]);
      assert.equal(1.875, cpu.float32[1]);

      assert.equal(0, cpu.int32[0]);
      assert.equal(0x3FF00000, cpu.int32[1]);

      assert.equal(0, cpu.uint32[0]);
      assert.equal(0x3FF00000, cpu.uint32[1]);
    });
  });
  describe('store_64', () => {
    it('should store the correct values', () => {
      cpu.store_64(4, 0xdeadbeef, 0xfacecafe);
      assert.equal(0xdeadbeef, cpu.uint32[4]);
      assert.equal(0xfacecafe, cpu.uint32[5]);
    });
  });
  describe('store_float_as_long', () => {
    it('should work with small values', () => {
      cpu.store_float_as_long(2, 1.0);
      assert.equal(1, cpu.uint32[2]);
      assert.equal(0, cpu.uint32[3]);
    });
    it('should work with large values', () => {
      cpu.store_float_as_long(2, (2 * 1024 * 1024 * 1024 * 1024) + 13);
      assert.equal(13, cpu.uint32[2]);
      assert.equal(512, cpu.uint32[3]);
    });
  });
  describe('store_f64', () => {
    it('should store the correct values', () => {
      cpu.store_f64(4, 3.142);
      assert.equal(3.142, cpu.float64[2]);
    });
  });
  describe('load_f64', () => {
    it('should load the correct values', () => {
      cpu.float64[2] = 1.112;
      assert.equal(1.112, cpu.load_f64(4));
    });
  });
  describe('load_f64_as_double', () => {
    it('should load the correct values', () => {
      cpu.int32[0] = 0x1c8;
      cpu.int32[1] = 0x7b;
      assert.equal(0x7B000001C8, cpu.load_s64_as_double(0));
    });
  });
});
