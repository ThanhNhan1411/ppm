import { describe, test, expect } from "bun:test";
import {
  MAX_IMAGE_DIMENSION,
  estimateImageTokens,
  fitWithin,
} from "../../../src/shared/image-limits.ts";

describe("fitWithin", () => {
  test("leaves an image that is already under the cap alone", () => {
    expect(fitWithin(1024, 768)).toBeNull();
    expect(fitWithin(MAX_IMAGE_DIMENSION - 1, 10)).toBeNull();
  });

  // The cap is a ceiling, so measuring exactly it is already over — the case that made a
  // whole session unusable while every audit reported nothing wrong.
  test("scales an image measuring exactly the cap", () => {
    const out = fitWithin(MAX_IMAGE_DIMENSION, 1000);
    expect(out).not.toBeNull();
    expect(out!.width).toBe(MAX_IMAGE_DIMENSION - 1);
  });

  test("brings the longest side strictly under the cap", () => {
    for (const [w, h] of [[4000, 3000], [3000, 4000], [2500, 2500], [8000, 100]]) {
      const out = fitWithin(w!, h!)!;
      expect(Math.max(out.width, out.height)).toBeLessThan(MAX_IMAGE_DIMENSION);
    }
  });

  test("keeps the aspect ratio within a pixel", () => {
    const out = fitWithin(4000, 3000)!;
    expect(Math.abs(out.width / out.height - 4000 / 3000)).toBeLessThan(0.01);
  });

  test("scales the taller side when the image is portrait", () => {
    const out = fitWithin(1000, 5000)!;
    expect(out.height).toBe(MAX_IMAGE_DIMENSION - 1);
    expect(out.width).toBeLessThan(out.height);
  });

  test("a square lands square", () => {
    const out = fitWithin(5000, 5000)!;
    expect(out.width).toBe(out.height);
    expect(out.width).toBe(MAX_IMAGE_DIMENSION - 1);
  });

  // An extreme banner would otherwise round its short side to zero, which no encoder accepts.
  test("never rounds a side down to zero", () => {
    const out = fitWithin(20000, 3)!;
    expect(out.height).toBeGreaterThanOrEqual(1);
  });

  test("honours a custom cap", () => {
    const out = fitWithin(4000, 2000, 1000)!;
    expect(Math.max(out.width, out.height)).toBe(999);
  });

  test("refuses nonsense dimensions rather than inventing them", () => {
    expect(fitWithin(0, 100)).toBeNull();
    expect(fitWithin(-5, 100)).toBeNull();
    expect(fitWithin(Number.NaN, 100)).toBeNull();
  });
});

describe("estimateImageTokens", () => {
  // Cost tracks pixels, which is why trimming 2000px to 1999px saves nothing and a real
  // reduction has to cut the area.
  test("follows the area rule", () => {
    expect(estimateImageTokens(2000, 1500)).toBe(4000);
    expect(estimateImageTokens(1000, 750)).toBe(1000);
  });

  test("shaving one pixel off the cap saves nothing worth counting", () => {
    const before = estimateImageTokens(2000, 1500);
    const after = estimateImageTokens(1999, 1499);
    expect((before - after) / before).toBeLessThan(0.01);
  });

  test("halving the longest side quarters the cost", () => {
    const full = estimateImageTokens(2000, 1500);
    const half = estimateImageTokens(1000, 750);
    expect(half / full).toBeCloseTo(0.25, 2);
  });

  test("zero for a degenerate size", () => {
    expect(estimateImageTokens(0, 100)).toBe(0);
  });
});
