import { describe, expect, it } from "vitest";
import type { QuantizedNote } from "../score/types";
import { fifthsFor, inferKey, keySignatureAlter, spellPitch } from "./key";

function seq(midis: number[], durationTicks = 4): QuantizedNote[] {
  return midis.map((midi, i) => ({ startTick: i * durationTicks, durationTicks, midi }));
}

describe("inferKey", () => {
  it("identifies C major from its scale", () => {
    // Tonic-weighted: end back on C.
    const key = inferKey(seq([60, 62, 64, 65, 67, 69, 71, 72, 60]));
    expect(key).toMatchObject({ tonicPc: 0, mode: "major", fifths: 0 });
  });

  it("identifies G major from its scale", () => {
    const key = inferKey(seq([67, 69, 71, 72, 74, 76, 78, 79, 67]));
    expect(key).toMatchObject({ tonicPc: 7, mode: "major", fifths: 1 });
  });

  it("identifies A minor from its harmonic-minor scale", () => {
    const key = inferKey(seq([69, 71, 72, 74, 76, 77, 80, 81, 69, 69]));
    expect(key).toMatchObject({ tonicPc: 9, mode: "minor", fifths: 0 });
  });
});

describe("fifthsFor", () => {
  it("maps tonics to circle-of-fifths positions", () => {
    expect(fifthsFor(0, "major")).toBe(0); // C
    expect(fifthsFor(2, "major")).toBe(2); // D
    expect(fifthsFor(5, "major")).toBe(-1); // F
    expect(fifthsFor(10, "major")).toBe(-2); // Bb
    expect(fifthsFor(9, "minor")).toBe(0); // Am
    expect(fifthsFor(4, "minor")).toBe(1); // Em
    expect(fifthsFor(0, "minor")).toBe(-3); // Cm
  });
});

describe("spellPitch", () => {
  it("spells sharps in sharp keys", () => {
    const gMajor = { tonicPc: 7, mode: "major" as const, fifths: 1 };
    expect(spellPitch(66, gMajor)).toEqual({ step: "F", alter: 1, octave: 4 });
  });

  it("spells flats in flat keys", () => {
    const fMajor = { tonicPc: 5, mode: "major" as const, fifths: -1 };
    expect(spellPitch(70, fMajor)).toEqual({ step: "B", alter: -1, octave: 4 });
  });

  it("computes octaves correctly", () => {
    const c = { tonicPc: 0, mode: "major" as const, fifths: 0 };
    expect(spellPitch(60, c)).toEqual({ step: "C", alter: 0, octave: 4 });
    expect(spellPitch(59, c)).toEqual({ step: "B", alter: 0, octave: 3 });
  });
});

describe("keySignatureAlter", () => {
  it("reflects the key signature's accidentals", () => {
    const gMajor = { tonicPc: 7, mode: "major" as const, fifths: 1 };
    const fMajor = { tonicPc: 5, mode: "major" as const, fifths: -1 };
    const cMajor = { tonicPc: 0, mode: "major" as const, fifths: 0 };
    expect(keySignatureAlter("F", gMajor)).toBe(1);
    expect(keySignatureAlter("C", gMajor)).toBe(0);
    expect(keySignatureAlter("B", fMajor)).toBe(-1);
    expect(keySignatureAlter("F", cMajor)).toBe(0);
  });
});
