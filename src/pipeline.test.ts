// @vitest-environment jsdom
/**
 * End-to-end pipeline tests: synthesize PCM audio, then run the REAL
 * audio→notes→score pipeline (pitch tracking, segmentation, tempo/key
 * inference, quantization, harmonization, MusicXML serialization) on it.
 * Includes robustness cases: vibrato, glides, and background noise.
 */
import { describe, expect, it } from "vitest";
import { detectNotes } from "./audio/detectNotes";
import { toMidiBytes } from "./export/midiExport";
import { toMusicXML } from "./score/musicxml";
import { addPart, emptyScore } from "./score/scoreOps";
import { midiToFreq } from "./score/types";

const SAMPLE_RATE = 48000;

interface ToneSpec {
  midi: number;
  startSec: number;
  durSec: number;
}

interface SynthOptions {
  /** Vibrato rate in Hz and depth in ± semitones. */
  vibrato?: { rateHz: number; semitones: number };
  /** Uniform white-noise amplitude mixed over the whole take. */
  noiseAmp?: number;
}

/** Render tones as enveloped sine waves (phase-continuous under vibrato). */
function synthesize(tones: ToneSpec[], totalSec: number, opts: SynthOptions = {}): Float32Array {
  const pcm = new Float32Array(Math.ceil(totalSec * SAMPLE_RATE));
  for (const tone of tones) {
    const start = Math.floor(tone.startSec * SAMPLE_RATE);
    const length = Math.floor(tone.durSec * SAMPLE_RATE);
    const rampLen = Math.floor(0.015 * SAMPLE_RATE);
    let phase = 0;
    for (let i = 0; i < length && start + i < pcm.length; i++) {
      const t = i / SAMPLE_RATE;
      let midi = tone.midi;
      if (opts.vibrato) {
        midi += opts.vibrato.semitones * Math.sin(2 * Math.PI * opts.vibrato.rateHz * t);
      }
      phase += (2 * Math.PI * midiToFreq(midi)) / SAMPLE_RATE;
      const envelope = Math.min(1, i / rampLen) * Math.min(1, (length - i) / rampLen);
      pcm[start + i] += 0.3 * envelope * Math.sin(phase);
    }
  }
  if (opts.noiseAmp) {
    // Deterministic pseudo-noise so the test can't flake.
    let seed = 12345;
    for (let i = 0; i < pcm.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pcm[i] += opts.noiseAmp * ((seed / 0x7fffffff) * 2 - 1);
    }
  }
  return pcm;
}

/** A continuous tone gliding between two pitches (legato pitch change). */
function synthesizeGlide(
  midiA: number,
  midiB: number,
  secA: number,
  glideSec: number,
  secB: number,
): Float32Array {
  const totalSec = secA + glideSec + secB + 0.4;
  const pcm = new Float32Array(Math.ceil(totalSec * SAMPLE_RATE));
  const start = Math.floor(0.2 * SAMPLE_RATE);
  const length = Math.floor((secA + glideSec + secB) * SAMPLE_RATE);
  const rampLen = Math.floor(0.015 * SAMPLE_RATE);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const midi =
      t < secA
        ? midiA
        : t < secA + glideSec
          ? midiA + ((t - secA) / glideSec) * (midiB - midiA)
          : midiB;
    phase += (2 * Math.PI * midiToFreq(midi)) / SAMPLE_RATE;
    const envelope = Math.min(1, i / rampLen) * Math.min(1, (length - i) / rampLen);
    pcm[start + i] = 0.3 * envelope * Math.sin(phase);
  }
  return pcm;
}

/** C major scale at 120 BPM with a quarter/eighth rhythm (disambiguates tempo). */
function scaleMelody(): { tones: ToneSpec[]; midis: number[] } {
  const midis = [60, 62, 64, 65, 67, 69, 71, 72];
  const onsetsBeats = [0, 1, 1.5, 2, 3, 4, 4.5, 5];
  const beat = 0.5; // 120 BPM
  const tones = midis.map((midi, i) => {
    const next = i + 1 < onsetsBeats.length ? onsetsBeats[i + 1] : onsetsBeats[i] + 2;
    return {
      midi,
      startSec: 0.2 + onsetsBeats[i] * beat,
      durSec: (next - onsetsBeats[i]) * beat - 0.08,
    };
  });
  return { tones, midis };
}

describe("hum → score pipeline", () => {
  it("detects the right notes from synthesized audio", () => {
    const { tones, midis } = scaleMelody();
    const pcm = synthesize(tones, 3.5);
    const raw = detectNotes(pcm, SAMPLE_RATE);
    expect(raw.map((n) => n.midi)).toEqual(midis);
  });

  it("builds a full score: tempo, key, quantization, chords, MusicXML, MIDI", () => {
    const { tones, midis } = scaleMelody();
    const raw = detectNotes(synthesize(tones, 3.5), SAMPLE_RATE);
    const score = addPart(emptyScore(), raw, "melody", "Melody");

    expect(Math.abs(score.bpm - 120)).toBeLessThanOrEqual(3);
    expect(score.key).toMatchObject({ tonicPc: 0, mode: "major" });
    expect(score.parts[0].notes.map((n) => n.midi)).toEqual(midis);
    expect(score.parts[0].notes[0].startTick).toBe(0);
    expect(score.chords.length).toBe(score.totalTicks / 16);
    expect(score.chords[score.chords.length - 1].rootPc).toBe(0); // ends on C

    // MusicXML is well-formed and every measure sums to 16 ticks.
    const doc = new DOMParser().parseFromString(toMusicXML(score), "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    for (const measure of doc.querySelectorAll("part > measure")) {
      const sum = [...measure.querySelectorAll(":scope > note > duration")]
        .map((d) => Number(d.textContent))
        .reduce((s, d) => s + d, 0);
      expect(sum).toBe(16);
    }

    // MIDI export produces a valid SMF header.
    const bytes = toMidiBytes(score);
    expect([...bytes.slice(0, 4)]).toEqual([0x4d, 0x54, 0x68, 0x64]); // "MThd"
  });

  it("keeps an overdubbed part's real entry point (bass entering on beat 3)", () => {
    const { tones } = scaleMelody();
    const raw = detectNotes(synthesize(tones, 3.5), SAMPLE_RATE);
    let score = addPart(emptyScore(), raw, "melody", "Melody");
    const bpmAfterFirst = score.bpm;

    // Bass recorded to the count-in: enters after two beats of silence.
    const beat = 0.5;
    const bassTones: ToneSpec[] = [
      { midi: 48, startSec: 1.0, durSec: 2 * beat - 0.08 },
      { midi: 55, startSec: 1.0 + 2 * beat, durSec: 2 * beat - 0.08 },
      { midi: 48, startSec: 1.0 + 4 * beat, durSec: 2 * beat - 0.08 },
    ];
    const bassRaw = detectNotes(synthesize(bassTones, 4.2), SAMPLE_RATE);
    score = addPart(score, bassRaw, "bass", "Bass");

    expect(score.bpm).toBe(bpmAfterFirst); // grid unchanged
    expect(score.parts).toHaveLength(2);
    expect(score.parts[1].clef).toBe("bass");
    expect(score.parts[1].notes.map((n) => n.midi)).toEqual([48, 55, 48]);
    // Entry on tick 8 (beat 3) is preserved; half notes on the shared grid.
    expect(score.parts[1].notes.map((n) => n.startTick)).toEqual([8, 16, 24]);
    expect(score.parts[1].notes.map((n) => n.durationTicks)).toEqual([8, 8, 8]);
  });

  it("does not split notes on vibrato", () => {
    const tones: ToneSpec[] = [{ midi: 69, startSec: 0.2, durSec: 1.2 }];
    const pcm = synthesize(tones, 1.8, { vibrato: { rateHz: 6, semitones: 0.7 } });
    const raw = detectNotes(pcm, SAMPLE_RATE);
    expect(raw.map((n) => n.midi)).toEqual([69]);
  });

  it("splits a legato glide into its two target notes", () => {
    const pcm = synthesizeGlide(60, 64, 1.0, 0.08, 1.0);
    const raw = detectNotes(pcm, SAMPLE_RATE);
    expect(raw.map((n) => n.midi)).toEqual([60, 64]);
  });

  it("survives background noise (breathy signal)", () => {
    const { tones, midis } = scaleMelody();
    const pcm = synthesize(tones, 3.5, { noiseAmp: 0.04 });
    const raw = detectNotes(pcm, SAMPLE_RATE);
    expect(raw.map((n) => n.midi)).toEqual(midis);
  });
});
