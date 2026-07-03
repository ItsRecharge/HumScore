import { describe, expect, it } from "vitest";
import type { RawNote } from "../score/types";
import { quantize } from "./quantize";

function raw(startSec: number, endSec: number, midi: number): RawNote {
  return { startSec, endSec, midi, midiFloat: midi, energy: 0.1 };
}

describe("quantize", () => {
  it("snaps clean quarter notes at 120 BPM to the grid", () => {
    // 120 BPM → sixteenth = 0.125 s, quarter = 4 ticks.
    const notes = [raw(0, 0.45, 60), raw(0.5, 0.95, 62), raw(1.0, 1.45, 64)];
    const q = quantize(notes, 120, 0);
    expect(q).toEqual([
      { startTick: 0, durationTicks: 4, midi: 60 },
      { startTick: 4, durationTicks: 4, midi: 62 },
      { startTick: 8, durationTicks: 4, midi: 64 },
    ]);
  });

  it("tolerates onset jitter", () => {
    const notes = [raw(0.02, 0.46, 60), raw(0.49, 0.97, 62), raw(1.03, 1.44, 64)];
    const q = quantize(notes, 120, 0);
    expect(q.map((n) => n.startTick)).toEqual([0, 4, 8]);
  });

  it("shifts the first note to tick 0", () => {
    const q = quantize([raw(2.0, 2.45, 60), raw(2.5, 2.95, 62)], 120, 0);
    expect(q[0].startTick).toBe(0);
    expect(q[1].startTick).toBe(4);
  });

  it("gives very short notes a minimum duration of one tick", () => {
    const q = quantize([raw(0, 0.02, 60)], 120, 0);
    expect(q).toEqual([{ startTick: 0, durationTicks: 1, midi: 60 }]);
  });

  it("repairs overlaps so the result is monophonic", () => {
    const q = quantize([raw(0, 0.7, 60), raw(0.5, 0.95, 62)], 120, 0);
    for (let i = 1; i < q.length; i++) {
      expect(q[i].startTick).toBeGreaterThanOrEqual(q[i - 1].startTick + q[i - 1].durationTicks);
    }
    expect(q).toHaveLength(2);
  });

  it("merges same-pitch fragments split by a tiny gap", () => {
    const q = quantize([raw(0, 0.24, 60), raw(0.26, 0.5, 60)], 120, 0);
    expect(q).toEqual([{ startTick: 0, durationTicks: 4, midi: 60 }]);
  });

  it("returns empty for no notes", () => {
    expect(quantize([], 120, 0)).toEqual([]);
  });
});
