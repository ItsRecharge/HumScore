/** Ticks per quarter note. 1 tick = one sixteenth. */
export const DIVISIONS = 4;
/** 4/4 only in v1. */
export const TICKS_PER_MEASURE = 16;

/**
 * The seam between the audio (signal) domain and the theory (symbolic)
 * domain. Everything upstream speaks seconds; everything downstream ticks.
 */
export interface RawNote {
  startSec: number;
  endSec: number;
  /** Rounded MIDI note number. */
  midi: number;
  /** Median detected pitch in fractional MIDI, kept for debugging. */
  midiFloat: number;
  /** Mean RMS over the note, used for velocity. */
  energy: number;
}

export interface QuantizedNote {
  startTick: number;
  durationTicks: number;
  midi: number;
}

export type Mode = "major" | "minor";

export interface KeySignature {
  /** Pitch class of the tonic, 0 = C. */
  tonicPc: number;
  mode: Mode;
  /** Circle-of-fifths position, negative = flats. */
  fifths: number;
}

export type ChordQuality = "major" | "minor" | "diminished";

export interface ChordSymbol {
  startTick: number;
  durationTicks: number;
  rootPc: number;
  quality: ChordQuality;
  /** Display label, e.g. "Am", "Bdim". */
  label: string;
}

export type PartRole = "melody" | "bass" | "counter";
export type Clef = "treble" | "bass";

export interface Part {
  id: string;
  name: string;
  role: PartRole;
  clef: Clef;
  /** Retained so a BPM/phase change can re-quantize losslessly. */
  rawNotes: RawNote[];
  /** Phase offset (seconds) used when this part was quantized. */
  phaseSec: number;
  notes: QuantizedNote[];
}

export interface Score {
  bpm: number;
  bpmSource: "inferred" | "manual";
  /** 0..1 — low values trigger a "set BPM manually" hint. */
  tempoConfidence: number;
  key: KeySignature;
  keySource: "inferred" | "manual";
  timeSig: { beats: 4; beatType: 4 };
  parts: Part[];
  chords: ChordSymbol[];
  chordsEnabled: boolean;
  /** Multiple of TICKS_PER_MEASURE covering all parts. */
  totalTicks: number;
}

export const PITCH_CLASS_NAMES_SHARP = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;
export const PITCH_CLASS_NAMES_FLAT = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
] as const;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${PITCH_CLASS_NAMES_SHARP[pc]}${octave}`;
}

export function secPerTick(bpm: number): number {
  return 15 / bpm;
}
