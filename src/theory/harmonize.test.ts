import { describe, expect, it } from "vitest";
import type { KeySignature, Part, QuantizedNote } from "../score/types";
import { harmonize } from "./harmonize";

const C_MAJOR: KeySignature = { tonicPc: 0, mode: "major", fifths: 0 };
const A_MINOR: KeySignature = { tonicPc: 9, mode: "minor", fifths: 0 };

function part(notes: QuantizedNote[]): Part {
  return {
    id: "p1",
    name: "Melody",
    role: "melody",
    clef: "treble",
    rawNotes: [],
    phaseSec: 0,
    notes,
  };
}

/** One measure of an arpeggiated triad: four quarter notes. */
function arpeggio(measure: number, midis: [number, number, number, number]): QuantizedNote[] {
  return midis.map((midi, i) => ({ startTick: measure * 16 + i * 4, durationTicks: 4, midi }));
}

describe("harmonize", () => {
  it("follows clearly arpeggiated harmony in C major", () => {
    const notes = [
      ...arpeggio(0, [60, 64, 67, 64]), // C E G E → C
      ...arpeggio(1, [65, 69, 72, 69]), // F A C A → F
      ...arpeggio(2, [67, 71, 74, 71]), // G B D B → G
      ...arpeggio(3, [60, 64, 67, 60]), // C E G C → C
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 64);
    expect(chords.map((c) => c.label)).toEqual(["C", "F", "G", "C"]);
  });

  it("tiles the whole score contiguously with merged chords", () => {
    const notes = arpeggio(0, [60, 64, 67, 64]);
    const chords = harmonize([part(notes)], C_MAJOR, 48);
    expect(chords[0].startTick).toBe(0);
    let cursor = 0;
    for (const c of chords) {
      expect(c.startTick).toBe(cursor);
      cursor += c.durationTicks;
    }
    expect(cursor).toBe(48);
  });

  it("keeps one chord for a stable measure but splits a clear mid-measure change", () => {
    // Measure 1: F A F A | G B G B — F major then G major, half and half.
    const notes = [
      { startTick: 0, durationTicks: 2, midi: 65 },
      { startTick: 2, durationTicks: 2, midi: 69 },
      { startTick: 4, durationTicks: 2, midi: 65 },
      { startTick: 6, durationTicks: 2, midi: 69 },
      { startTick: 8, durationTicks: 2, midi: 67 },
      { startTick: 10, durationTicks: 2, midi: 71 },
      { startTick: 12, durationTicks: 2, midi: 67 },
      { startTick: 14, durationTicks: 2, midi: 71 },
      // Measure 2: stable C arpeggio → one chord.
      ...arpeggio(1, [60, 64, 67, 60]),
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 32);
    expect(chords.map((c) => c.label)).toEqual(["F", "G", "C"]);
    expect(chords[0]).toMatchObject({ startTick: 0, durationTicks: 8 });
    expect(chords[1]).toMatchObject({ startTick: 8, durationTicks: 8 });
    expect(chords[2]).toMatchObject({ startTick: 16, durationTicks: 16 });
  });

  it("resolves an ambiguous scale ending to the tonic", () => {
    const notes = [
      ...arpeggio(0, [60, 64, 67, 64]),
      ...arpeggio(1, [65, 69, 72, 69]),
      ...arpeggio(2, [67, 71, 74, 71]),
      ...arpeggio(3, [74, 71, 72, 72]), // D B C C — cadence pulls home
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 64);
    expect(chords[chords.length - 1].rootPc).toBe(0);
  });

  it("keeps a half cadence when the ending is unambiguously dominant", () => {
    const notes = [
      ...arpeggio(0, [60, 64, 67, 64]),
      ...arpeggio(1, [67, 71, 74, 67]), // pure G material to the end
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 32);
    expect(chords[chords.length - 1].rootPc).toBe(7);
  });

  it("labels minor-key chords correctly", () => {
    const notes = [
      ...arpeggio(0, [69, 72, 76, 72]), // A C E → Am
      ...arpeggio(1, [69, 72, 76, 69]),
    ];
    const chords = harmonize([part(notes)], A_MINOR, 32);
    expect(chords[0].label).toBe("Am");
    expect(chords[0].quality).toBe("minor");
  });

  it("returns empty for an empty score", () => {
    expect(harmonize([part([])], C_MAJOR, 0)).toEqual([]);
  });

  it("windows chords by the given measure length (3/4)", () => {
    const notes = [
      ...[60, 64, 67].map((midi, i) => ({ startTick: i * 4, durationTicks: 4, midi })),
      ...[67, 71, 74].map((midi, i) => ({ startTick: 12 + i * 4, durationTicks: 4, midi })),
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 24, 12);
    expect(chords.map((c) => c.label)).toEqual(["C", "G"]);
    expect(chords[0]).toMatchObject({ startTick: 0, durationTicks: 12 });
    expect(chords[1]).toMatchObject({ startTick: 12, durationTicks: 12 });
  });
});
