import type { RawNote } from "../score/types";
import type { PitchFrame } from "./pitchTrack";

/** All segmentation thresholds in one place so they can be tuned. */
export const SEGMENT_DEFAULTS = {
  clarityThreshold: 0.9,
  minRms: 0.005,
  noiseFloorFactor: 2.5,
  /** Percentile of frame RMS treated as the noise floor. */
  noiseFloorPercentile: 0.05,
  /**
   * The gate may never exceed this fraction of the loud (p90) level —
   * protects legato takes where even quiet percentiles contain signal.
   */
  maxGateFractionOfLoud: 0.3,
  medianFilterFrames: 5,
  /** Unvoiced gaps up to this many frames are bridged. */
  bridgeFrames: 2,
  /** Pitch jump (semitones) that starts a new note... */
  pitchJumpSemitones: 0.6,
  /** ...when sustained for this many consecutive frames. */
  pitchJumpFrames: 3,
  /** Re-articulation: local RMS min below this fraction of the envelope. */
  dipEnvelopeFactor: 0.5,
  dipEnvelopeWindowSec: 0.1,
  /** ...followed by a rebound of at least this factor within dipReboundSec. */
  dipReboundFactor: 1.4,
  dipReboundSec: 0.06,
  minNoteSec: 0.08,
  minMidi: 40,
  maxMidi: 88,
};

type SegmentOptions = typeof SEGMENT_DEFAULTS;

interface VoicedFrame {
  timeSec: number;
  midi: number;
  rms: number;
  /** Index in the original frame array, for gap bridging. */
  frameIndex: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

function freqToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Split one voiced run into notes at pitch jumps and re-articulation dips. */
function splitRun(run: VoicedFrame[], opts: SegmentOptions, frameSec: number): VoicedFrame[][] {
  const splits = new Set<number>(); // indices where a new note starts

  // Pitch jumps: compare each frame to the running median of the current
  // note's recent frames; a sustained deviation marks an onset.
  let noteStart = 0;
  let deviatingSince = -1;
  for (let i = 1; i < run.length; i++) {
    const refFrames = run
      .slice(Math.max(noteStart, i - opts.medianFilterFrames), i)
      .map((f) => f.midi);
    const ref = median(refFrames);
    if (Math.abs(run[i].midi - ref) > opts.pitchJumpSemitones) {
      if (deviatingSince < 0) deviatingSince = i;
      if (i - deviatingSince + 1 >= opts.pitchJumpFrames) {
        splits.add(deviatingSince);
        noteStart = deviatingSince;
        deviatingSince = -1;
      }
    } else {
      deviatingSince = -1;
    }
  }

  // Re-articulation dips: a deep local RMS minimum with a quick rebound.
  const envelopeFrames = Math.max(1, Math.round(opts.dipEnvelopeWindowSec / frameSec));
  const reboundFrames = Math.max(1, Math.round(opts.dipReboundSec / frameSec));
  for (let i = 1; i < run.length - 1; i++) {
    const isLocalMin = run[i].rms <= run[i - 1].rms && run[i].rms < run[i + 1].rms;
    if (!isLocalMin) continue;
    let envelope = 0;
    for (let j = Math.max(0, i - envelopeFrames); j < i; j++) {
      envelope = Math.max(envelope, run[j].rms);
    }
    if (run[i].rms >= opts.dipEnvelopeFactor * envelope) continue;
    let rebounds = false;
    for (let j = i + 1; j <= Math.min(run.length - 1, i + reboundFrames); j++) {
      if (run[j].rms >= opts.dipReboundFactor * run[i].rms) {
        rebounds = true;
        break;
      }
    }
    if (rebounds) splits.add(i + 1);
  }

  const boundaries = [0, ...[...splits].sort((a, b) => a - b), run.length];
  const notes: VoicedFrame[][] = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const chunk = run.slice(boundaries[b], boundaries[b + 1]);
    if (chunk.length > 0) notes.push(chunk);
  }
  return notes;
}

/**
 * Turn a frame-level pitch track into discrete notes: gate by clarity and
 * relative energy, median-filter the pitch, group voiced runs, split at
 * pitch jumps / re-articulations, and guard against octave errors.
 */
export function segmentNotes(
  frames: PitchFrame[],
  options: Partial<SegmentOptions> = {},
): RawNote[] {
  const opts = { ...SEGMENT_DEFAULTS, ...options };
  if (frames.length < 2) return [];
  const frameSec = frames[1].timeSec - frames[0].timeSec;

  const allRms = frames.map((f) => f.rms);
  const noiseFloor = percentile(allRms, opts.noiseFloorPercentile);
  const loud = percentile(allRms, 0.9);
  const rmsGate = Math.max(
    opts.minRms,
    Math.min(opts.noiseFloorFactor * noiseFloor, opts.maxGateFractionOfLoud * loud),
  );

  const voiced: VoicedFrame[] = [];
  frames.forEach((f, i) => {
    if (f.freqHz !== null && f.clarity >= opts.clarityThreshold && f.rms >= rmsGate) {
      voiced.push({ timeSec: f.timeSec, midi: freqToMidi(f.freqHz), rms: f.rms, frameIndex: i });
    }
  });
  if (voiced.length === 0) return [];

  // Median-filter the pitch trajectory to kill octave blips.
  const half = Math.floor(opts.medianFilterFrames / 2);
  const filtered = voiced.map((f, i) => ({
    ...f,
    midi: median(
      voiced.slice(Math.max(0, i - half), Math.min(voiced.length, i + half + 1)).map((v) => v.midi),
    ),
  }));

  // Group into runs, bridging short unvoiced gaps.
  const runs: VoicedFrame[][] = [];
  let current: VoicedFrame[] = [filtered[0]];
  for (let i = 1; i < filtered.length; i++) {
    const gap = filtered[i].frameIndex - filtered[i - 1].frameIndex - 1;
    if (gap > opts.bridgeFrames) {
      runs.push(current);
      current = [];
    }
    current.push(filtered[i]);
  }
  runs.push(current);

  // Split runs into notes and materialize RawNotes.
  const notes: RawNote[] = [];
  for (const run of runs) {
    for (const chunk of splitRun(run, opts, frameSec)) {
      const startSec = chunk[0].timeSec - frameSec / 2;
      const endSec = chunk[chunk.length - 1].timeSec + frameSec / 2;
      if (endSec - startSec < opts.minNoteSec) continue;
      const midiFloat = median(chunk.map((f) => f.midi));
      notes.push({
        startSec,
        endSec,
        midi: Math.round(midiFloat),
        midiFloat,
        energy: chunk.reduce((s, f) => s + f.rms, 0) / chunk.length,
      });
    }
  }
  if (notes.length === 0) return [];

  // Octave-error guard: fold outliers more than an octave from the take
  // median back toward it, then clamp to the plausible hum range.
  const globalMedian = median(notes.map((n) => n.midiFloat));
  for (const n of notes) {
    while (n.midiFloat - globalMedian > 12) {
      n.midiFloat -= 12;
      n.midi -= 12;
    }
    while (globalMedian - n.midiFloat > 12) {
      n.midiFloat += 12;
      n.midi += 12;
    }
    n.midi = Math.max(opts.minMidi, Math.min(opts.maxMidi, n.midi));
  }
  return notes;
}
