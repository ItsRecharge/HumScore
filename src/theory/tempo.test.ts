import { describe, expect, it } from "vitest";
import type { RawNote } from "../score/types";
import { fitPhase, inferTempo } from "./tempo";

function raw(startSec: number, endSec: number, midi = 60): RawNote {
  return { startSec, endSec, midi, midiFloat: midi, energy: 0.1 };
}

/** A rhythmically varied melody (quarters + eighths) at the given BPM. */
function melodyAt(bpm: number, offsetSec = 0): RawNote[] {
  const beat = 60 / bpm;
  // Onsets in beats: quarter, two eighths, quarter, quarter, eighths...
  const onsetsBeats = [0, 1, 1.5, 2, 3, 4, 4.5, 5, 6, 7, 7.5, 8];
  const dursBeats = [0.9, 0.45, 0.45, 0.9, 0.9, 0.45, 0.45, 0.9, 0.9, 0.45, 0.45, 1.8];
  return onsetsBeats.map((b, i) =>
    raw(offsetSec + b * beat, offsetSec + (b + dursBeats[i]) * beat),
  );
}

describe("inferTempo", () => {
  it("recovers the tempo of a clean 120 BPM melody", () => {
    const { bpm, confidence } = inferTempo(melodyAt(120));
    expect(bpm).toBe(120);
    expect(confidence).toBeGreaterThan(0);
  });

  it("recovers 90 BPM", () => {
    expect(inferTempo(melodyAt(90)).bpm).toBe(90);
  });

  it("is robust to ±20 ms onset jitter", () => {
    // Deterministic pseudo-jitter.
    const jittered = melodyAt(120).map((n, i) => {
      const j = ((i * 7919) % 41) / 1000 - 0.02; // -20..+20 ms
      return { ...n, startSec: n.startSec + j, endSec: n.endSec + j };
    });
    const { bpm } = inferTempo(jittered);
    expect(Math.abs(bpm - 120)).toBeLessThanOrEqual(3);
  });

  it("returns zero confidence for fewer than two notes", () => {
    expect(inferTempo([raw(0, 0.5)]).confidence).toBe(0);
    expect(inferTempo([]).confidence).toBe(0);
  });
});

describe("fitPhase", () => {
  it("recovers the phase of an offset melody at a known BPM", () => {
    const offset = 0.1;
    const notes = melodyAt(120, offset);
    const { phaseSec, score } = fitPhase(
      notes.map((n) => n.startSec),
      notes.map(() => 1),
      120,
    );
    // Phase is only meaningful modulo the sixteenth step (0.125 s at 120).
    const step = 15 / 120;
    const diff = Math.abs(((phaseSec - offset) % step) + step) % step;
    expect(Math.min(diff, step - diff)).toBeLessThan(0.02);
    expect(score).toBeGreaterThan(0.9);
  });
});
