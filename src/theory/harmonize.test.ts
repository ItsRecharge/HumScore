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

  it("produces one chord per measure covering the whole score", () => {
    const notes = arpeggio(0, [60, 64, 67, 64]);
    const chords = harmonize([part(notes)], C_MAJOR, 48);
    expect(chords).toHaveLength(3);
    expect(chords[0]).toMatchObject({ startTick: 0, durationTicks: 16 });
    expect(chords[2].startTick).toBe(32);
  });

  it("ends on the tonic", () => {
    const notes = [
      ...arpeggio(0, [60, 64, 67, 64]),
      ...arpeggio(1, [67, 71, 74, 71]),
      ...arpeggio(2, [65, 69, 72, 69]),
      ...arpeggio(3, [67, 71, 74, 67]), // dominant material, but cadence pulls home
    ];
    const chords = harmonize([part(notes)], C_MAJOR, 64);
    expect(chords[chords.length - 1].rootPc).toBe(0);
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
});
