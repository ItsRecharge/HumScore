/** Ticks per quarter note. 1 tick = one sixteenth. */
export const DIVISIONS = 4;
/** Ticks per measure in the default 4/4. */
export const TICKS_PER_MEASURE = 16;

export interface TimeSignature {
  beats: 2 | 3 | 4;
  beatType: 4;
}

/** Ticks per measure for a given meter (quarter-note beats only). */
export function measureTicks(timeSig: TimeSignature): number {
  return timeSig.beats * DIVISIONS;
}

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
  /** 0..1, derived from the hum's energy; drives playback/MIDI dynamics. */
  velocity?: number;
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
  muted?: boolean;
  solo?: boolean;
  /** Manual grid shift (ticks) applied on top of quantization — pickup fixes. */
  offsetTicks?: number;
}

export interface Score {
  title: string;
  bpm: number;
  bpmSource: "inferred" | "manual";
  /** 0..1 — low values trigger a "set BPM manually" hint. */
  tempoConfidence: number;
  key: KeySignature;
  keySource: "inferred" | "manual";
  timeSig: TimeSignature;
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
