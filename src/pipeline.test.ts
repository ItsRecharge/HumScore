// @vitest-environment jsdom
/**
 * End-to-end pipeline test: synthesize PCM audio of a melody, then run the
 * REAL audio→notes→score pipeline (pitch tracking, segmentation, tempo/key
 * inference, quantization, harmonization, MusicXML serialization) on it.
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

/** Render tones as enveloped sine waves with silence between them. */
function synthesize(tones: ToneSpec[], totalSec: number): Float32Array {
  const pcm = new Float32Array(Math.ceil(totalSec * SAMPLE_RATE));
  for (const tone of tones) {
    const freq = midiToFreq(tone.midi);
    const start = Math.floor(tone.startSec * SAMPLE_RATE);
    const length = Math.floor(tone.durSec * SAMPLE_RATE);
    const rampLen = Math.floor(0.015 * SAMPLE_RATE);
    for (let i = 0; i < length && start + i < pcm.length; i++) {
      const envelope =
        Math.min(1, i / rampLen) * Math.min(1, (length - i) / rampLen);
      pcm[start + i] = 0.3 * envelope * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE);
    }
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

  it("quantizes a second part against the grid established by the first", () => {
    const { tones } = scaleMelody();
    const raw = detectNotes(synthesize(tones, 3.5), SAMPLE_RATE);
    let score = addPart(emptyScore(), raw, "melody", "Melody");
    const bpmAfterFirst = score.bpm;

    // A slow bass line: C2–G2–C2 half notes at the same tempo.
    const beat = 0.5;
    const bassTones: ToneSpec[] = [
      { midi: 48, startSec: 0.3, durSec: 2 * beat - 0.08 },
      { midi: 55, startSec: 0.3 + 2 * beat, durSec: 2 * beat - 0.08 },
      { midi: 48, startSec: 0.3 + 4 * beat, durSec: 2 * beat - 0.08 },
    ];
    const bassRaw = detectNotes(synthesize(bassTones, 3.5), SAMPLE_RATE);
    score = addPart(score, bassRaw, "bass", "Bass");

    expect(score.bpm).toBe(bpmAfterFirst); // grid unchanged
    expect(score.parts).toHaveLength(2);
    expect(score.parts[1].clef).toBe("bass");
    expect(score.parts[1].notes.map((n) => n.midi)).toEqual([48, 55, 48]);
    // Half notes on the shared grid.
    expect(score.parts[1].notes.map((n) => n.durationTicks)).toEqual([8, 8, 8]);
  });
});
