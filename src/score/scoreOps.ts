import { harmonize } from "../theory/harmonize";
import { fifthsFor, inferKey } from "../theory/key";
import { quantize } from "../theory/quantize";
import { fitPhase, inferTempo } from "../theory/tempo";
import {
  measureTicks,
  type Clef,
  type KeySignature,
  type Mode,
  type Part,
  type PartRole,
  type RawNote,
  type Score,
  type TimeSignature,
} from "./types";

export function emptyScore(): Score {
  return {
    bpm: 100,
    bpmSource: "inferred",
    tempoConfidence: 0,
    key: { tonicPc: 0, mode: "major", fifths: 0 },
    keySource: "inferred",
    timeSig: { beats: 4, beatType: 4 },
    parts: [],
    chords: [],
    chordsEnabled: true,
    totalTicks: 0,
  };
}

function clefFor(rawNotes: RawNote[]): Clef {
  if (rawNotes.length === 0) return "treble";
  const mean = rawNotes.reduce((s, n) => s + n.midi, 0) / rawNotes.length;
  return mean < 57 ? "bass" : "treble";
}

function computeTotalTicks(parts: Part[], timeSig: TimeSignature): number {
  let maxEnd = 0;
  for (const p of parts) {
    for (const n of p.notes) {
      maxEnd = Math.max(maxEnd, n.startTick + n.durationTicks);
    }
  }
  const tpm = measureTicks(timeSig);
  return Math.ceil(maxEnd / tpm) * tpm;
}

/** Re-derive key (if inferred), chords and length after any note change. */
function recompute(score: Score): Score {
  const totalTicks = computeTotalTicks(score.parts, score.timeSig);
  const key =
    score.keySource === "inferred" && score.parts.length > 0
      ? inferKey(score.parts.flatMap((p) => p.notes))
      : score.key;
  const chords = harmonize(score.parts, key, totalTicks, measureTicks(score.timeSig));
  return { ...score, key, chords, totalTicks };
}

function nextPartId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `part-${Math.random().toString(36).slice(2)}`;
}

/**
 * Add a recorded part. The first part establishes the tempo grid (and key);
 * later parts only fit a phase against the existing BPM.
 */
export function addPart(
  score: Score,
  rawNotes: RawNote[],
  role: PartRole,
  name: string,
): Score {
  let next = { ...score };
  let phaseSec: number;
  const isFirst = next.parts.length === 0;
  if (isFirst && next.bpmSource === "inferred") {
    const estimate = inferTempo(rawNotes);
    next.bpm = estimate.bpm;
    next.tempoConfidence = estimate.confidence;
    phaseSec = estimate.phaseSec;
  } else {
    phaseSec = fitPhase(
      rawNotes.map((n) => n.startSec),
      rawNotes.map((n) => Math.min(1, n.endSec - n.startSec)),
      next.bpm,
    ).phaseSec;
  }
  const part: Part = {
    id: nextPartId(),
    name,
    role,
    clef: clefFor(rawNotes),
    rawNotes,
    phaseSec,
    // Overdubs recorded to the count-in keep their real entry point.
    notes: quantize(rawNotes, next.bpm, phaseSec, { preserveOffset: !isFirst }),
  };
  next = { ...next, parts: [...next.parts, part] };
  return recompute(next);
}

/** Re-record an existing part, keeping its identity. */
export function replacePartRecording(score: Score, partId: string, rawNotes: RawNote[]): Score {
  const next = { ...score };
  if (next.parts.length === 1 && next.parts[0].id === partId && next.bpmSource === "inferred") {
    // Sole part re-recorded: re-establish the grid.
    const estimate = inferTempo(rawNotes);
    next.bpm = estimate.bpm;
    next.tempoConfidence = estimate.confidence;
  }
  const isSolePart = next.parts.length === 1;
  next.parts = next.parts.map((p) => {
    if (p.id !== partId) return p;
    const phaseSec = fitPhase(
      rawNotes.map((n) => n.startSec),
      rawNotes.map((n) => Math.min(1, n.endSec - n.startSec)),
      next.bpm,
    ).phaseSec;
    return {
      ...p,
      clef: clefFor(rawNotes),
      rawNotes,
      phaseSec,
      notes: quantize(rawNotes, next.bpm, phaseSec, { preserveOffset: !isSolePart }),
    };
  });
  return recompute(next);
}

export function deletePart(score: Score, partId: string): Score {
  return recompute({ ...score, parts: score.parts.filter((p) => p.id !== partId) });
}

export function renamePart(score: Score, partId: string, name: string): Score {
  return {
    ...score,
    parts: score.parts.map((p) => (p.id === partId ? { ...p, name } : p)),
  };
}

/** Manual BPM override: re-quantize every part from its raw notes. */
export function setBpm(score: Score, bpm: number): Score {
  const parts = score.parts.map((p, i) => {
    const phaseSec = fitPhase(
      p.rawNotes.map((n) => n.startSec),
      p.rawNotes.map((n) => Math.min(1, n.endSec - n.startSec)),
      bpm,
    ).phaseSec;
    return {
      ...p,
      phaseSec,
      notes: quantize(p.rawNotes, bpm, phaseSec, { preserveOffset: i > 0 }),
    };
  });
  return recompute({ ...score, bpm, bpmSource: "manual", tempoConfidence: 1, parts });
}

export function setKey(score: Score, selection: "auto" | { tonicPc: number; mode: Mode }): Score {
  if (selection === "auto") {
    return recompute({ ...score, keySource: "inferred" });
  }
  const key: KeySignature = {
    tonicPc: selection.tonicPc,
    mode: selection.mode,
    fifths: fifthsFor(selection.tonicPc, selection.mode),
  };
  return recompute({ ...score, key, keySource: "manual" });
}

export function setChordsEnabled(score: Score, enabled: boolean): Score {
  return { ...score, chordsEnabled: enabled };
}

/** Re-barring only — the sixteenth grid itself is meter-independent. */
export function setTimeSig(score: Score, beats: TimeSignature["beats"]): Score {
  return recompute({ ...score, timeSig: { beats, beatType: 4 } });
}

export function togglePartMuted(score: Score, partId: string): Score {
  return {
    ...score,
    parts: score.parts.map((p) => (p.id === partId ? { ...p, muted: !p.muted } : p)),
  };
}

export function togglePartSolo(score: Score, partId: string): Score {
  return {
    ...score,
    parts: score.parts.map((p) => (p.id === partId ? { ...p, solo: !p.solo } : p)),
  };
}

/** Nudge a quantized note's pitch/duration, or delete it. */
export function editNote(
  score: Score,
  partId: string,
  noteIndex: number,
  patch: { deltaSemitones?: number; deltaTicks?: number; delete?: boolean },
): Score {
  const parts = score.parts.map((p) => {
    if (p.id !== partId) return p;
    let notes = p.notes;
    if (patch.delete) {
      notes = notes.filter((_, i) => i !== noteIndex);
    } else {
      notes = notes.map((n, i) => {
        if (i !== noteIndex) return n;
        const midi = n.midi + (patch.deltaSemitones ?? 0);
        let durationTicks = Math.max(1, n.durationTicks + (patch.deltaTicks ?? 0));
        // Don't grow into the next note of this (monophonic) part.
        const next = p.notes[i + 1];
        if (next) {
          durationTicks = Math.min(durationTicks, next.startTick - n.startTick);
        }
        return { ...n, midi, durationTicks };
      });
    }
    return { ...p, notes };
  });
  return recompute({ ...score, parts });
}
