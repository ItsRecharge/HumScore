import type { QuantizedNote, RawNote } from "../score/types";

const MERGE_GAP_SEC = 0.03;

export interface QuantizeOptions {
  /**
   * Keep the notes' absolute grid position instead of shifting the first
   * note to tick 0. Used for overdubbed parts: recording starts on the
   * downbeat (after the count-in), so silence before the entry is real.
   */
  preserveOffset?: boolean;
}

/**
 * Snap raw notes (seconds) onto the sixteenth grid defined by bpm + phase.
 * Guarantees a monophonic, non-overlapping, chronologically sorted result.
 */
export function quantize(
  notes: RawNote[],
  bpm: number,
  phaseSec: number,
  opts: QuantizeOptions = {},
): QuantizedNote[] {
  if (notes.length === 0) return [];
  const step = 15 / bpm;
  const tick = (t: number) => Math.round((t - phaseSec) / step);

  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec);

  // Merge fragments the segmenter over-split: same pitch, near-zero raw gap.
  const merged: RawNote[] = [];
  for (const n of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.startSec - prev.endSec < MERGE_GAP_SEC) {
      prev.endSec = n.endSec;
      prev.energy = Math.max(prev.energy, n.energy);
    } else {
      merged.push({ ...n });
    }
  }

  const maxEnergy = Math.max(...merged.map((n) => n.energy), 1e-6);
  let quantized: QuantizedNote[] = merged.map((n) => {
    const startTick = tick(n.startSec);
    const endTick = Math.max(startTick + 1, tick(n.endSec));
    return {
      startTick,
      durationTicks: endTick - startTick,
      midi: n.midi,
      velocity: 0.5 + 0.5 * (n.energy / maxEnergy),
    };
  });

  // Anchor to the grid: either the first note defines tick 0, or (overdub)
  // absolute positions are kept — only pulled up if latency made them negative.
  const minTick = Math.min(...quantized.map((n) => n.startTick));
  const shift = opts.preserveOffset ? Math.min(0, minTick) : minTick;
  quantized = quantized.map((n) => ({ ...n, startTick: n.startTick - shift }));

  // Repair monophonic overlaps: truncate at the next onset; drop collapsed notes.
  const result: QuantizedNote[] = [];
  for (let i = 0; i < quantized.length; i++) {
    const n = { ...quantized[i] };
    const next = quantized[i + 1];
    if (next && next.startTick < n.startTick + n.durationTicks) {
      n.durationTicks = next.startTick - n.startTick;
    }
    if (n.durationTicks > 0) result.push(n);
  }

  // Legato gap absorption: hums separate notes with breath gaps, so a lone
  // sixteenth rest between notes is almost always noise — extend the note.
  for (let i = 0; i < result.length - 1; i++) {
    const gap = result[i + 1].startTick - (result[i].startTick + result[i].durationTicks);
    if (gap === 1) result[i].durationTicks += 1;
  }
  // Likewise the final note, cut short by the breath release: round its end
  // up to the beat boundary when it lands one tick shy.
  const last = result[result.length - 1];
  if (last && (last.startTick + last.durationTicks) % 4 === 3) {
    last.durationTicks += 1;
  }
  return result;
}
