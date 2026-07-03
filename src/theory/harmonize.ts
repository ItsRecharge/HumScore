import {
  PITCH_CLASS_NAMES_FLAT,
  PITCH_CLASS_NAMES_SHARP,
  TICKS_PER_MEASURE,
  type ChordQuality,
  type ChordSymbol,
  type KeySignature,
  type Part,
} from "../score/types";


const TONIC = 0;
const SUPERTONIC = 1;
const MEDIANT = 2;
const SUBDOMINANT = 3;
const DOMINANT = 4;
const SUBMEDIANT = 5;

interface ChordState {
  /** Semitones above the tonic. */
  degree: number;
  quality: ChordQuality;
  /** Harmonic function slot used by the transition model. */
  func: number;
}

/** I ii iii IV V vi */
const MAJOR_STATES: ChordState[] = [
  { degree: 0, quality: "major", func: TONIC },
  { degree: 2, quality: "minor", func: SUPERTONIC },
  { degree: 4, quality: "minor", func: MEDIANT },
  { degree: 5, quality: "major", func: SUBDOMINANT },
  { degree: 7, quality: "major", func: DOMINANT },
  { degree: 9, quality: "minor", func: SUBMEDIANT },
];

/** i III iv V VI VII (harmonic-minor V; VII fills the predominant slot) */
const MINOR_STATES: ChordState[] = [
  { degree: 0, quality: "minor", func: TONIC },
  { degree: 3, quality: "major", func: MEDIANT },
  { degree: 5, quality: "minor", func: SUBDOMINANT },
  { degree: 7, quality: "major", func: DOMINANT },
  { degree: 8, quality: "major", func: SUBMEDIANT },
  { degree: 10, quality: "major", func: SUPERTONIC },
];

/**
 * How much emission (what the notes actually spell) outweighs the
 * functional-harmony transition preferences: a perfectly arpeggiated
 * triad must beat any voice-leading bonus.
 */
const EMISSION_WEIGHT = 5;
const START_TONIC_BONUS = 1.5;
/** Strong pull toward ending on the tonic — scale endings often outline
 * subdominant/submediant tones and would otherwise win on emission. */
const FINAL_TONIC_BONUS = 3.0;
/**
 * Penalty for changing chords at a non-barline segment boundary. High enough
 * that mild emission preferences keep one chord per measure; a genuinely
 * different half-measure harmony (ratio ≳ e^0.2 per weight unit) still splits.
 */
const MID_MEASURE_CHANGE_PENALTY = 1.8;
/** Tie-breaker toward primary triads (I/IV/V) when coverage is ambiguous. */
const PRIMARY_TRIAD_BONUS = 0.25;

function chordTones(state: ChordState, tonicPc: number): Set<number> {
  const root = (tonicPc + state.degree) % 12;
  const third = state.quality === "major" ? 4 : 3;
  const fifth = state.quality === "diminished" ? 6 : 7;
  return new Set([root, (root + third) % 12, (root + fifth) % 12]);
}

function diatonicPcs(key: KeySignature): Set<number> {
  const steps = key.mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11];
  return new Set(steps.map((s) => (key.tonicPc + s) % 12));
}

function beatStrength(tick: number, ticksPerMeasure: number): number {
  if (tick % ticksPerMeasure === 0) return 2.0;
  if (ticksPerMeasure % 8 === 0 && tick % 8 === 0) return 1.5;
  if (tick % 4 === 0) return 1.2;
  return 1.0;
}

/** Log-domain transition preference between chord functions. */
function transitionScore(from: number, to: number): number {
  let score = 0;
  if (to === TONIC) score += from === DOMINANT ? 1.2 : from === SUBDOMINANT ? 0.8 : 0.4;
  if (from === SUBMEDIANT && to === SUPERTONIC) score += 0.8;
  if (from === SUPERTONIC && to === DOMINANT) score += 1.0;
  if (from === MEDIANT && to === SUBMEDIANT) score += 0.6;
  if (from === TONIC && to !== TONIC) score += 0.5;
  if (from === to) score -= 0.3;
  if (to === MEDIANT) score -= 0.6;
  return score;
}

function chordLabel(state: ChordState, key: KeySignature): string {
  const rootPc = (key.tonicPc + state.degree) % 12;
  const names = key.fifths < 0 ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP;
  const suffix = state.quality === "minor" ? "m" : state.quality === "diminished" ? "dim" : "";
  return `${names[rootPc]}${suffix}`;
}

/**
 * Rule-based harmonization: Viterbi over diatonic triads on half-measure
 * segments (whole measures in odd meters), with mid-measure chord changes
 * penalized so they happen only on strong evidence. Emission =
 * beat-strength/duration-weighted chord-tone coverage of all parts' notes;
 * transitions encode functional harmony preferences. Consecutive identical
 * chords are merged into one symbol.
 */
export function harmonize(
  parts: Part[],
  key: KeySignature,
  totalTicks: number,
  ticksPerMeasure: number = TICKS_PER_MEASURE,
): ChordSymbol[] {
  const segTicks = ticksPerMeasure >= 16 ? ticksPerMeasure / 2 : ticksPerMeasure;
  const measures = Math.ceil(totalTicks / segTicks);
  if (measures === 0) return [];
  const states = key.mode === "major" ? MAJOR_STATES : MINOR_STATES;
  const diatonic = diatonicPcs(key);
  const allNotes = parts.flatMap((p) => p.notes);

  // Emission scores per segment per state.
  const logE: number[][] = [];
  for (let m = 0; m < measures; m++) {
    const mStart = m * segTicks;
    const mEnd = mStart + segTicks;
    const row: number[] = [];
    for (const state of states) {
      const tones = chordTones(state, key.tonicPc);
      let covered = 0;
      let total = 0;
      for (const n of allNotes) {
        const overlap =
          Math.min(mEnd, n.startTick + n.durationTicks) - Math.max(mStart, n.startTick);
        if (overlap <= 0) continue;
        const w = overlap * beatStrength(n.startTick, ticksPerMeasure);
        total += w;
        const pc = ((n.midi % 12) + 12) % 12;
        if (tones.has(pc)) covered += w;
        else if (diatonic.has(pc)) covered += 0.15 * w;
      }
      const emission = total > 0 ? covered / total : 0.5;
      const primary =
        state.func === TONIC || state.func === SUBDOMINANT || state.func === DOMINANT
          ? PRIMARY_TRIAD_BONUS
          : 0;
      row.push(EMISSION_WEIGHT * Math.log(emission + 1e-3) + primary);
    }
    logE.push(row);
  }

  // Viterbi.
  const S = states.length;
  const dp: number[][] = [
    logE[0].map((e, s) => e + (states[s].func === TONIC ? START_TONIC_BONUS : 0)),
  ];
  const back: number[][] = [new Array(S).fill(-1)];
  for (let m = 1; m < measures; m++) {
    const isLast = m === measures - 1;
    const midMeasure = (m * segTicks) % ticksPerMeasure !== 0;
    const row: number[] = [];
    const backRow: number[] = [];
    for (let s = 0; s < S; s++) {
      let bestPrev = 0;
      let bestVal = -Infinity;
      for (let p = 0; p < S; p++) {
        // Functional-harmony preferences describe measure-level motion; at a
        // mid-measure boundary only the change penalty applies.
        let t = midMeasure
          ? p === s
            ? 0
            : -MID_MEASURE_CHANGE_PENALTY
          : transitionScore(states[p].func, states[s].func);
        if (isLast && states[p].func === DOMINANT && states[s].func === TONIC) t += 1.0;
        const v = dp[m - 1][p] + t;
        if (v > bestVal) {
          bestVal = v;
          bestPrev = p;
        }
      }
      row.push(
        bestVal + logE[m][s] + (isLast && states[s].func === TONIC ? FINAL_TONIC_BONUS : 0),
      );
      backRow.push(bestPrev);
    }
    dp.push(row);
    back.push(backRow);
  }

  // Backtrack.
  let s = dp[measures - 1].indexOf(Math.max(...dp[measures - 1]));
  const path: number[] = new Array(measures);
  for (let m = measures - 1; m >= 0; m--) {
    path[m] = s;
    s = back[m][s];
  }

  // Merge consecutive identical chords into single symbols.
  const chords: ChordSymbol[] = [];
  for (let m = 0; m < measures; m++) {
    const state = states[path[m]];
    const prev = chords[chords.length - 1];
    if (prev && m > 0 && path[m] === path[m - 1]) {
      prev.durationTicks += segTicks;
      continue;
    }
    chords.push({
      startTick: m * segTicks,
      durationTicks: segTicks,
      rootPc: (key.tonicPc + state.degree) % 12,
      quality: state.quality,
      label: chordLabel(state, key),
    });
  }
  return chords;
}
