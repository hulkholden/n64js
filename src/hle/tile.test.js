import { beforeEach, describe, expect, test } from 'bun:test';
import { Tile } from "./tile.js";

describe('Tile', () => {
  let tile;
  beforeEach(function () {
    tile = new Tile();
  });

  describe('constructor', () => {
    test('should initialize members', () => {
      expect(tile.format).toBe(-1);
      expect(tile.size).toBe(0);
      expect(tile.line).toBe(0);
      expect(tile.tmem).toBe(0);
      expect(tile.palette).toBe(0);
      expect(tile.cmT).toBe(0);
      expect(tile.maskT).toBe(0);
      expect(tile.shiftT).toBe(0);
      expect(tile.cmS).toBe(0);
      expect(tile.maskS).toBe(0);
      expect(tile.shiftS).toBe(0);
      expect(tile.uls).toBe(0);
      expect(tile.ult).toBe(0);
      expect(tile.lrs).toBe(0);
      expect(tile.lrt).toBe(0);
      expect(tile.hash).toBe(0);
    });
  });
  describe('coordinate properties', () => {
    test('should use uls,ult,lrs,lrt', () => {
      tile.uls = 5;
      tile.ult = 6;
      tile.lrs = 7;
      tile.lrt = 8;
      expect(tile.left).toBe(1.25);
      expect(tile.top).toBe(1.5);
      expect(tile.right).toBe(1.75);
      expect(tile.bottom).toBe(2);
    });
  });
  describe('dimension properties', () => {
    test('should be at least 1', () => {
      tile.uls = 0;
      tile.ult = 0;
      tile.lrs = 0;
      tile.lrt = 0;
      expect(tile.width).toBe(1);
      expect(tile.height).toBe(1);
    });
    test('should use uls,ult,lrs,lrt', () => {
      tile.uls = 5;
      tile.ult = 102;
      tile.lrs = 9;
      tile.lrt = 108;
      expect(tile.width).toBe(2);
      expect(tile.height).toBe(3);
    });
    test('should use maskS to compute width', () => {
      tile.uls = 0;
      tile.lrs = 100;

      let results = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => {
        tile.maskS = mask;
        return tile.width;
      });
      expect(results).toEqual([26, 2, 4, 8, 16, 26, 26, 26]);
    });
    test('should use maskT to compute height', () => {
      tile.ult = 0;
      tile.lrt = 200;

      let results = [0, 1, 2, 3, 4, 5, 6, 7].map(mask => {
        tile.maskT = mask;
        return tile.height;
      });
      expect(results).toEqual([51, 2, 4, 8, 16, 32, 51, 51]);
    });
  });
});
