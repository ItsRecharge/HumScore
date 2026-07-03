import type { RawNote } from "../score/types";

export interface TempoEstimate {
  bpm: number;
  phaseSec: number;
  confidence: number;
}

const MIN_BPM = 55;
const MAX_BPM = 180;
const PRIOR_CENTER = 100;
const PRIOR_SIGMA = 35;
const PHASE_STEPS = 24;

/** Distance (normalized 0..0.5) from an onset to the nearest grid line. */
function gridDistance(t: number, phase: number, step: number): number {
  const r = (((t - phase) % step) + step) % step;
  return Math.min(r, step - r) / step;
}

/**
 * How well the onsets fit a sixteenth grid at the given bpm/phase.
 * Duration-weighted, squared so near-hits dominate. Returns 0..1.
 */
function gridFit(
  onsets: number[],
  weights: number[],
  phase: number,
  step: number,
): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < onsets.length; i++) {
    const d = gridDistance(onsets[i], phase, step);
    num += weights[i] * Math.pow(1 - 2 * d, 2);
    den += weights[i];
  }
  return den > 0 ? num / den : 0;
}

/** Best phase for a fixed bpm — used when later parts join an established grid. */
export function fitPhase(
  onsets: number[],
  weights: number[],
  bpm: number,
): { phaseSec: number; score: number } {
  const step = 15 / bpm;
  let bestPhase = 0;
  let bestScore = -1;
  const candidates: number[] = [];
  for (let i = 0; i < PHASE_STEPS; i++) candidates.push((i / PHASE_STEPS) * step);
  if (onsets.length > 0) candidates.push(((onsets[0] % step) + step) % step);
  for (const phase of candidates) {
    const score = gridFit(onsets, weights, phase, step);
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return { phaseSec: bestPhase, score: bestScore };
}

/**
 * How well inter-onset intervals land on whole multiples of the eighth
 * note at this tempo. Phase-free, so it complements the grid fit and is
 * what actually separates a tempo from its neighbors and octaves.
 */
function ioiFit(onsets: number[], weights: number[], bpm: number): number {
  const eighth = 30 / bpm;
  let num = 0;
  let den = 0;
  for (let i = 1; i < onsets.length; i++) {
    const ratio = (onsets[i] - onsets[i - 1]) / eighth;
    const w = Math.min(weights[i], weights[i - 1]);
    // An IOI shorter than half an eighth can't be a real rhythmic unit here.
    const d = ratio < 0.5 ? 0.5 : Math.min(0.5, Math.abs(ratio - Math.round(ratio)));
    num += w * Math.pow(1 - 2 * d, 2);
    den += w;
  }
  return den > 0 ? num / den : 0;
}

function medianQuantizedLength(notes: RawNote[], bpm: number): number {
  const step = 15 / bpm;
  const lens = notes
    .map((n) => Math.max(1, Math.round((n.endSec - n.startSec) / step)))
    .sort((a, b) => a - b);
  return lens.length ? lens[Math.floor(lens.length / 2)] : 0;
}

/**
 * Infer tempo from note onsets by scoring how well each candidate BPM's
 * sixteenth grid fits the onsets, weighted by note duration, with a
 * Gaussian prior around 100 BPM to break the slow-tempo degeneracy.
 */
export function inferTempo(notes: RawNote[]): TempoEstimate {
  if (notes.length < 2) {
    return { bpm: 100, phaseSec: notes[0]?.startSec ?? 0, confidence: 0 };
  }
  const onsets = notes.map((n) => n.startSec);
  const weights = notes.map((n) => Math.min(1, n.endSec - n.startSec));

  interface Candidate {
    bpm: number;
    phaseSec: number;
    score: number;
  }
  const candidates: Candidate[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm++) {
    const med = medianQuantizedLength(notes, bpm);
    if (med < 1 || med > 8) continue;
    const { phaseSec, score: gridScore } = fitPhase(onsets, weights, bpm);
    const fit = 0.5 * gridScore + 0.5 * ioiFit(onsets, weights, bpm);
    const prior = Math.exp(-Math.pow(bpm - PRIOR_CENTER, 2) / (2 * PRIOR_SIGMA * PRIOR_SIGMA));
    candidates.push({ bpm, phaseSec, score: fit * prior });
  }
  if (candidates.length === 0) {
    return { bpm: 100, phaseSec: onsets[0], confidence: 0 };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Confidence: margin over the best candidate outside the winner's
  // neighborhood (±8 BPM and its tempo octaves).
  const isNeighbor = (bpm: number) =>
    Math.abs(bpm - best.bpm) <= 8 ||
    Math.abs(bpm - best.bpm * 2) <= 8 ||
    Math.abs(bpm - best.bpm / 2) <= 8;
  const rival = candidates.find((c) => !isNeighbor(c.bpm));
  const confidence = rival ? Math.max(0, 1 - rival.score / best.score) : 1;

  return { bpm: best.bpm, phaseSec: best.phaseSec, confidence };
}
