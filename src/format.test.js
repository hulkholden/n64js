import { describe, expect, test } from 'bun:test';
import * as format from "./format.js";

describe('format', () => {
  describe('padString', () => {
    test('should pad the number to the correct length', () => {
      expect(format.padString(7, 1)).toBe('7');
      expect(format.padString(7, 2)).toBe('07');
      expect(format.padString(7, 3)).toBe('007');
    });
    test('should not truncate values', () => {
      expect(format.padString(700, 1)).toBe('700');
    });
  });
  describe('toHex', () => {
    test('should return correctly formatted strings', () => {
      expect(format.toHex(0)).toBe('0');
      expect(format.toHex(0x1)).toBe('1');
      expect(format.toHex(0x12)).toBe('12');
      expect(format.toHex(0x123)).toBe('123');
      expect(format.toHex(0x1234)).toBe('1234');
      expect(format.toHex(0x12345)).toBe('12345');
      expect(format.toHex(0x123456)).toBe('123456');
      expect(format.toHex(0x1234567)).toBe('1234567');
      expect(format.toHex(0x12345678)).toBe('12345678');
      expect(format.toHex(0xdeadbeef)).toBe('deadbeef');
    });
  });
  describe('toString8', () => {
    test('should return correctly formatted strings', () => {
      expect(format.toString8(0)).toBe('0x00');
      expect(format.toString8(0xff)).toBe('0xff');
    });
  });
  describe('toString16', () => {
    test('should return correctly formatted strings', () => {
      expect(format.toString16(0)).toBe('0x0000');
      expect(format.toString16(0xff)).toBe('0x00ff');
      expect(format.toString16(0xffff)).toBe('0xffff');
    });
  });
  describe('toString32', () => {
    test('should return correctly formatted strings', () => {
      expect(format.toString32(0)).toBe('0x00000000');
      expect(format.toString32(0xff)).toBe('0x000000ff');
      expect(format.toString32(0xffffffff)).toBe('0xffffffff');
    });
  });
  describe('toString64', () => {
    test('should return correctly formatted strings', () => {
      expect(format.toString64(0n)).toBe('0x0000000000000000');
      expect(format.toString64(0xffn)).toBe('0x00000000000000ff');
      expect(format.toString64(0xffffffff_ffffffffn)).toBe('0xffffffffffffffff');
    });
  });
});
