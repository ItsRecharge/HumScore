import type { KeySignature, Mode, QuantizedNote } from "../score/types";

/** Krumhansl–Kessler key profiles. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Circle-of-fifths position for each major-key tonic pitch class. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export function fifthsFor(tonicPc: number, mode: Mode): number {
  const relativeMajorPc = mode === "major" ? tonicPc : (tonicPc + 3) % 12;
  return MAJOR_FIFTHS[relativeMajorPc];
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/**
 * Krumhansl–Kessler key finding: correlate the duration-weighted
 * pitch-class histogram against all 24 rotated key profiles.
 */
export function inferKey(notes: QuantizedNote[]): KeySignature {
  const histogram = new Array<number>(12).fill(0);
  for (const n of notes) {
    histogram[((n.midi % 12) + 12) % 12] += n.durationTicks;
  }

  let best: KeySignature = { tonicPc: 0, mode: "major", fifths: 0 };
  let bestScore = -Infinity;
  for (const mode of ["major", "minor"] as const) {
    const profile = mode === "major" ? MAJOR_PROFILE : MINOR_PROFILE;
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = histogram.map((_, pc) => histogram[(pc + tonic) % 12]);
      const score = pearson(rotated, profile);
      if (score > bestScore) {
        bestScore = score;
        best = { tonicPc: tonic, mode, fifths: fifthsFor(tonic, mode) };
      }
    }
  }
  return best;
}

export interface SpelledPitch {
  step: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  alter: -1 | 0 | 1;
  octave: number;
}

type Step = SpelledPitch["step"];

const SHARP_STEPS: Step[] = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const SHARP_ALTERS: (-1 | 0 | 1)[] = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const FLAT_STEPS: Step[] = ["C", "D", "D", "E", "E", "F", "G", "G", "A", "A", "B", "B"];
const FLAT_ALTERS: (-1 | 0 | 1)[] = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];

/** Spell a MIDI pitch in the given key: flat-wise in flat keys, sharp-wise otherwise. */
export function spellPitch(midi: number, key: KeySignature): SpelledPitch {
  const pc = ((midi % 12) + 12) % 12;
  const flat = key.fifths < 0;
  return {
    step: flat ? FLAT_STEPS[pc] : SHARP_STEPS[pc],
    alter: flat ? FLAT_ALTERS[pc] : SHARP_ALTERS[pc],
    octave: Math.floor(midi / 12) - 1,
  };
}

/** Alteration each step carries in the key signature (e.g. F→1 in G major). */
export function keySignatureAlter(step: Step, key: KeySignature): -1 | 0 | 1 {
  const SHARP_ORDER: Step[] = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER: Step[] = ["B", "E", "A", "D", "G", "C", "F"];
  if (key.fifths > 0 && SHARP_ORDER.indexOf(step) < key.fifths) return 1;
  if (key.fifths < 0 && FLAT_ORDER.indexOf(step) < -key.fifths) return -1;
  return 0;
}
