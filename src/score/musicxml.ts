import { keySignatureAlter, spellPitch } from "../theory/key";
import {
  DIVISIONS,
  TICKS_PER_MEASURE,
  type ChordSymbol,
  type KeySignature,
  type Part,
  type QuantizedNote,
  type Score,
} from "./types";

export interface DurationComponent {
  ticks: number;
  type: string;
  dots: number;
}

/** Note-type table in descending tick order (divisions = 4 per quarter). */
const TYPE_TABLE: DurationComponent[] = [
  { ticks: 16, type: "whole", dots: 0 },
  { ticks: 12, type: "half", dots: 1 },
  { ticks: 8, type: "half", dots: 0 },
  { ticks: 6, type: "quarter", dots: 1 },
  { ticks: 4, type: "quarter", dots: 0 },
  { ticks: 3, type: "eighth", dots: 1 },
  { ticks: 2, type: "eighth", dots: 0 },
  { ticks: 1, type: "16th", dots: 0 },
];

/**
 * Greedy largest-first decomposition of a within-measure duration into
 * renderable note values (e.g. 5 → quarter + 16th). Components of one
 * logical note are joined with ties by the caller.
 */
export function decomposeDuration(durTicks: number): DurationComponent[] {
  const out: DurationComponent[] = [];
  let remaining = durTicks;
  while (remaining > 0) {
    const comp = TYPE_TABLE.find((c) => c.ticks <= remaining);
    if (!comp) throw new Error(`cannot decompose duration ${durTicks}`);
    out.push(comp);
    remaining -= comp.ticks;
  }
  return out;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACCIDENTAL_NAMES: Record<number, string> = { [-1]: "flat", 0: "natural", 1: "sharp" };

interface MeasureItem {
  startTick: number; // absolute
  durationTicks: number; // clipped to the measure
  midi: number | null; // null = rest
  tieStop: boolean;
  tieStart: boolean;
}

/** Slice a part's notes + implicit rests into per-measure items with tie flags. */
function measureItems(notes: QuantizedNote[], measureIndex: number): MeasureItem[] {
  const mStart = measureIndex * TICKS_PER_MEASURE;
  const mEnd = mStart + TICKS_PER_MEASURE;
  const items: MeasureItem[] = [];
  let cursor = mStart;
  for (const n of notes) {
    const nEnd = n.startTick + n.durationTicks;
    if (nEnd <= mStart || n.startTick >= mEnd) continue;
    const start = Math.max(n.startTick, mStart);
    const end = Math.min(nEnd, mEnd);
    if (start > cursor) {
      items.push({ startTick: cursor, durationTicks: start - cursor, midi: null, tieStop: false, tieStart: false });
    }
    items.push({
      startTick: start,
      durationTicks: end - start,
      midi: n.midi,
      tieStop: n.startTick < mStart,
      tieStart: nEnd > mEnd,
    });
    cursor = end;
  }
  if (cursor < mEnd) {
    items.push({ startTick: cursor, durationTicks: mEnd - cursor, midi: null, tieStop: false, tieStart: false });
  }
  return items;
}

function noteXml(
  item: MeasureItem,
  key: KeySignature,
  measureAlters: Map<string, number>,
): string[] {
  const lines: string[] = [];
  if (item.midi === null) {
    // Whole-measure rest.
    if (item.durationTicks === TICKS_PER_MEASURE) {
      lines.push("      <note>");
      lines.push('        <rest measure="yes"/>');
      lines.push(`        <duration>${TICKS_PER_MEASURE}</duration>`);
      lines.push("      </note>");
      return lines;
    }
    for (const comp of decomposeDuration(item.durationTicks)) {
      lines.push("      <note>");
      lines.push("        <rest/>");
      lines.push(`        <duration>${comp.ticks}</duration>`);
      lines.push(`        <type>${comp.type}</type>`);
      for (let d = 0; d < comp.dots; d++) lines.push("        <dot/>");
      lines.push("      </note>");
    }
    return lines;
  }

  const spelled = spellPitch(item.midi, key);
  const stepKey = `${spelled.step}${spelled.octave}`;
  const effective = measureAlters.get(stepKey) ?? keySignatureAlter(spelled.step, key);
  const needsAccidental = spelled.alter !== effective;
  if (needsAccidental) measureAlters.set(stepKey, spelled.alter);

  const comps = decomposeDuration(item.durationTicks);
  comps.forEach((comp, i) => {
    const tieStop = i > 0 || item.tieStop;
    const tieStart = i < comps.length - 1 || item.tieStart;
    lines.push("      <note>");
    lines.push("        <pitch>");
    lines.push(`          <step>${spelled.step}</step>`);
    if (spelled.alter !== 0) lines.push(`          <alter>${spelled.alter}</alter>`);
    lines.push(`          <octave>${spelled.octave}</octave>`);
    lines.push("        </pitch>");
    lines.push(`        <duration>${comp.ticks}</duration>`);
    if (tieStop) lines.push('        <tie type="stop"/>');
    if (tieStart) lines.push('        <tie type="start"/>');
    lines.push(`        <type>${comp.type}</type>`);
    for (let d = 0; d < comp.dots; d++) lines.push("        <dot/>");
    if (needsAccidental && i === 0 && !item.tieStop) {
      lines.push(`        <accidental>${ACCIDENTAL_NAMES[spelled.alter]}</accidental>`);
    }
    if (tieStop || tieStart) {
      lines.push("        <notations>");
      if (tieStop) lines.push('          <tied type="stop"/>');
      if (tieStart) lines.push('          <tied type="start"/>');
      lines.push("        </notations>");
    }
    lines.push("      </note>");
  });
  return lines;
}

function harmonyXml(chord: ChordSymbol, key: KeySignature): string[] {
  const spelled = spellPitch(chord.rootPc + 60, key);
  const kindText = chord.quality === "minor" ? "m" : chord.quality === "diminished" ? "dim" : "";
  return [
    "      <harmony>",
    "        <root>",
    `          <root-step>${spelled.step}</root-step>`,
    ...(spelled.alter !== 0 ? [`          <root-alter>${spelled.alter}</root-alter>`] : []),
    "        </root>",
    `        <kind text="${kindText}">${chord.quality}</kind>`,
    "      </harmony>",
  ];
}

function attributesXml(part: Part, key: KeySignature): string[] {
  const clef = part.clef === "bass" ? ["F", "4"] : ["G", "2"];
  return [
    "      <attributes>",
    `        <divisions>${DIVISIONS}</divisions>`,
    "        <key>",
    `          <fifths>${key.fifths}</fifths>`,
    `          <mode>${key.mode}</mode>`,
    "        </key>",
    "        <time>",
    "          <beats>4</beats>",
    "          <beat-type>4</beat-type>",
    "        </time>",
    "        <clef>",
    `          <sign>${clef[0]}</sign>`,
    `          <line>${clef[1]}</line>`,
    "        </clef>",
    "      </attributes>",
  ];
}

function tempoXml(bpm: number): string[] {
  return [
    '      <direction placement="above">',
    "        <direction-type>",
    "          <metronome>",
    "            <beat-unit>quarter</beat-unit>",
    `            <per-minute>${bpm}</per-minute>`,
    "          </metronome>",
    "        </direction-type>",
    `        <sound tempo="${bpm}"/>`,
    "      </direction>",
  ];
}

export function toMusicXML(score: Score): string {
  const measures = Math.max(1, Math.ceil(score.totalTicks / TICKS_PER_MEASURE));
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    "  <work>",
    "    <work-title>HumScore</work-title>",
    "  </work>",
    "  <part-list>",
  ];
  score.parts.forEach((part, i) => {
    lines.push(`    <score-part id="P${i + 1}">`);
    lines.push(`      <part-name>${esc(part.name)}</part-name>`);
    lines.push("    </score-part>");
  });
  lines.push("  </part-list>");

  score.parts.forEach((part, partIdx) => {
    lines.push(`  <part id="P${partIdx + 1}">`);
    for (let m = 0; m < measures; m++) {
      lines.push(`    <measure number="${m + 1}">`);
      if (m === 0) {
        lines.push(...attributesXml(part, score.key));
        if (partIdx === 0) lines.push(...tempoXml(score.bpm));
      }
      const measureAlters = new Map<string, number>();
      for (const item of measureItems(part.notes, m)) {
        if (partIdx === 0 && score.chordsEnabled) {
          for (const chord of score.chords) {
            if (chord.startTick === item.startTick) lines.push(...harmonyXml(chord, score.key));
          }
        }
        lines.push(...noteXml(item, score.key, measureAlters));
      }
      lines.push("    </measure>");
    }
    lines.push("  </part>");
  });

  lines.push("</score-partwise>");
  return lines.join("\n");
}
