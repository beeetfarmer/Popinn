import { describe, expect, it } from "vitest";

import { transcodeProgressPercent } from "./transcode";

describe("transcodeProgressPercent", () => {
  it("returns 0 before a run has started, rather than NaN", () => {
    // total=0 is the pre-run state; NaN here would produce `width: NaN%`,
    // which browsers discard, leaving the bar visually full.
    expect(transcodeProgressPercent(0, 0)).toBe(0);
  });

  it("computes ordinary progress", () => {
    expect(transcodeProgressPercent(0, 4)).toBe(0);
    expect(transcodeProgressPercent(1, 4)).toBe(25);
    expect(transcodeProgressPercent(2, 4)).toBe(50);
    expect(transcodeProgressPercent(4, 4)).toBe(100);
  });

  it("rounds to whole percents", () => {
    expect(transcodeProgressPercent(1, 3)).toBe(33);
    expect(transcodeProgressPercent(2, 3)).toBe(67);
    expect(transcodeProgressPercent(1, 7)).toBe(14);
  });

  it("clamps above 100 when a stale poll overshoots", () => {
    expect(transcodeProgressPercent(9, 4)).toBe(100);
  });

  it("clamps negatives to 0", () => {
    expect(transcodeProgressPercent(-3, 4)).toBe(0);
  });

  it("treats a negative total as no progress", () => {
    expect(transcodeProgressPercent(2, -4)).toBe(0);
  });

  it("survives non-finite input instead of emitting NaN or Infinity", () => {
    expect(transcodeProgressPercent(NaN, 4)).toBe(0);
    expect(transcodeProgressPercent(2, NaN)).toBe(0);
    expect(transcodeProgressPercent(Infinity, 4)).toBe(0);
    expect(transcodeProgressPercent(2, Infinity)).toBe(0);
  });

  it("always returns a value usable as a CSS width", () => {
    const cases: Array<[number, number]> = [
      [0, 0], [1, 3], [9, 4], [-1, 5], [NaN, NaN], [2, Infinity],
    ];
    for (const [p, t] of cases) {
      const v = transcodeProgressPercent(p, t);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
