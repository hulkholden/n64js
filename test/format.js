import * as format from "../src/format.js";

const assert = require('chai').assert;

describe('format', () => {
  describe('padString', () => {
    it('should pad the number to the correct length', () => {
      assert.equal('7', format.padString(7, 1));
      assert.equal('07', format.padString(7, 2));
      assert.equal('007', format.padString(7, 3));
    });
    it('should not truncate values', () => {
      assert.equal('700', format.padString(700, 1));
    });
  });
  describe('toHex', () => {
    it('should return correctly formatted strings', () => {
      assert.equal('0', format.toHex(0));
      assert.equal('1', format.toHex(0x1));
      assert.equal('12', format.toHex(0x12));
      assert.equal('123', format.toHex(0x123));
      assert.equal('1234', format.toHex(0x1234));
      assert.equal('12345', format.toHex(0x12345));
      assert.equal('123456', format.toHex(0x123456));
      assert.equal('1234567', format.toHex(0x1234567));
      assert.equal('12345678', format.toHex(0x12345678));
      assert.equal('deadbeef', format.toHex(0xdeadbeef));
    });
  });
  describe('toString8', () => {
    it('should return correctly formatted strings', () => {
      assert.equal('0x00', format.toString8(0));
      assert.equal('0xff', format.toString8(0xff));
    });
  });
  describe('toString16', () => {
    it('should return correctly formatted strings', () => {
      assert.equal('0x0000', format.toString16(0));
      assert.equal('0x00ff', format.toString16(0xff));
      assert.equal('0xffff', format.toString16(0xffff));
    });
  });
  describe('toString32', () => {
    it('should return correctly formatted strings', () => {
      assert.equal('0x00000000', format.toString32(0));
      assert.equal('0x000000ff', format.toString32(0xff));
      assert.equal('0xffffffff', format.toString32(0xffffffff));
    });
  });
  describe('toString64', () => {
    it('should return correctly formatted strings', () => {
      assert.equal('0x0000000000000000', format.toString64(0, 0));
      assert.equal('0x00000000000000ff', format.toString64(0, 0xff));
      assert.equal('0xffffffffffffffff', format.toString64(0xffffffff, 0xffffffff));
    });
  });
});
