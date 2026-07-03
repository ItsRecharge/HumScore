// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decomposeDuration, toMusicXML } from "./musicxml";
import {
  TICKS_PER_MEASURE,
  type ChordSymbol,
  type Part,
  type QuantizedNote,
  type Score,
} from "./types";

function makePart(notes: QuantizedNote[], overrides: Partial<Part> = {}): Part {
  return {
    id: "p1",
    name: "Melody",
    role: "melody",
    clef: "treble",
    rawNotes: [],
    phaseSec: 0,
    notes,
    ...overrides,
  };
}

function makeScore(parts: Part[], overrides: Partial<Score> = {}): Score {
  const maxEnd = Math.max(
    0,
    ...parts.flatMap((p) => p.notes.map((n) => n.startTick + n.durationTicks)),
  );
  return {
    title: "Test Score",
    bpm: 100,
    bpmSource: "inferred",
    tempoConfidence: 1,
    key: { tonicPc: 0, mode: "major", fifths: 0 },
    keySource: "inferred",
    timeSig: { beats: 4, beatType: 4 },
    parts,
    chords: [],
    chordsEnabled: false,
    totalTicks: Math.max(TICKS_PER_MEASURE, Math.ceil(maxEnd / TICKS_PER_MEASURE) * TICKS_PER_MEASURE),
    ...overrides,
  };
}

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc;
}

describe("decomposeDuration", () => {
  it("covers every duration 1..16 exactly", () => {
    for (let d = 1; d <= 16; d++) {
      const comps = decomposeDuration(d);
      expect(comps.reduce((s, c) => s + c.ticks, 0)).toBe(d);
    }
  });

  it("maps simple values to single note types", () => {
    expect(decomposeDuration(4)).toEqual([{ ticks: 4, type: "quarter", dots: 0 }]);
    expect(decomposeDuration(6)).toEqual([{ ticks: 6, type: "quarter", dots: 1 }]);
    expect(decomposeDuration(16)).toEqual([{ ticks: 16, type: "whole", dots: 0 }]);
  });

  it("decomposes awkward values greedily", () => {
    expect(decomposeDuration(5).map((c) => c.ticks)).toEqual([4, 1]);
    expect(decomposeDuration(7).map((c) => c.ticks)).toEqual([6, 1]);
  });
});

describe("toMusicXML", () => {
  it("is well-formed and declares all parts", () => {
    const score = makeScore([
      makePart([{ startTick: 0, durationTicks: 4, midi: 60 }]),
      makePart([{ startTick: 0, durationTicks: 8, midi: 48 }], {
        id: "p2",
        name: "Bass",
        role: "bass",
        clef: "bass",
      }),
    ]);
    const doc = parse(toMusicXML(score));
    expect(doc.querySelectorAll("part-list > score-part")).toHaveLength(2);
    expect(doc.querySelectorAll("score-partwise > part")).toHaveLength(2);
    expect(doc.querySelector("clef > sign")?.textContent).toBe("G");
  });

  it("makes every measure of every part sum to exactly 16 ticks", () => {
    // Notes at awkward offsets, including ones crossing barlines.
    const score = makeScore([
      makePart([
        { startTick: 3, durationTicks: 5, midi: 60 },
        { startTick: 14, durationTicks: 7, midi: 62 }, // crosses measure 1→2
        { startTick: 30, durationTicks: 11, midi: 64 }, // crosses measure 2→3
      ]),
      makePart([{ startTick: 6, durationTicks: 26, midi: 48 }], { id: "p2", name: "Bass" }),
    ]);
    const doc = parse(toMusicXML(score));
    for (const measure of doc.querySelectorAll("part > measure")) {
      const durations = [...measure.querySelectorAll(":scope > note > duration")].map((d) =>
        Number(d.textContent),
      );
      expect(durations.reduce((s, d) => s + d, 0)).toBe(16);
    }
  });

  it("pairs every tie start with a tie stop across barlines", () => {
    const score = makeScore([
      makePart([{ startTick: 14, durationTicks: 7, midi: 62 }]),
    ]);
    const doc = parse(toMusicXML(score));
    const starts = doc.querySelectorAll('tie[type="start"]').length;
    const stops = doc.querySelectorAll('tie[type="stop"]').length;
    expect(starts).toBeGreaterThan(0);
    expect(starts).toBe(stops);
    expect(doc.querySelectorAll('tied[type="start"]')).toHaveLength(starts);
  });

  it("emits whole-measure rests for empty measures", () => {
    const score = makeScore(
      [makePart([{ startTick: 0, durationTicks: 4, midi: 60 }])],
      { totalTicks: 32 },
    );
    const doc = parse(toMusicXML(score));
    expect(doc.querySelectorAll('rest[measure="yes"]').length).toBeGreaterThan(0);
  });

  it("emits harmony chord symbols on the first part when enabled", () => {
    const chords: ChordSymbol[] = [
      { startTick: 0, durationTicks: 16, rootPc: 0, quality: "major", label: "C" },
      { startTick: 16, durationTicks: 16, rootPc: 9, quality: "minor", label: "Am" },
    ];
    const notes: QuantizedNote[] = [
      { startTick: 0, durationTicks: 16, midi: 60 },
      { startTick: 16, durationTicks: 16, midi: 69 },
    ];
    const withChords = makeScore([makePart(notes)], { chords, chordsEnabled: true });
    const doc = parse(toMusicXML(withChords));
    const harmonies = doc.querySelectorAll("harmony");
    expect(harmonies).toHaveLength(2);
    expect(harmonies[1].querySelector("root-step")?.textContent).toBe("A");
    expect(harmonies[1].querySelector("kind")?.textContent).toBe("minor");

    const withoutChords = makeScore([makePart(notes)], { chords, chordsEnabled: false });
    expect(parse(toMusicXML(withoutChords)).querySelectorAll("harmony")).toHaveLength(0);
  });

  it("writes the key signature and tempo", () => {
    const score = makeScore([makePart([{ startTick: 0, durationTicks: 4, midi: 62 }])], {
      key: { tonicPc: 2, mode: "major", fifths: 2 },
      bpm: 132,
    });
    const doc = parse(toMusicXML(score));
    expect(doc.querySelector("key > fifths")?.textContent).toBe("2");
    expect(doc.querySelector("per-minute")?.textContent).toBe("132");
    expect(doc.querySelector("sound")?.getAttribute("tempo")).toBe("132");
  });

  it("bars 3/4 correctly: every measure sums to 12 ticks", () => {
    const score = makeScore(
      [
        makePart([
          { startTick: 0, durationTicks: 4, midi: 60 },
          { startTick: 8, durationTicks: 8, midi: 64 }, // crosses the 3/4 barline at 12
          { startTick: 20, durationTicks: 3, midi: 67 },
        ]),
      ],
      { timeSig: { beats: 3, beatType: 4 }, totalTicks: 24 },
    );
    const doc = parse(toMusicXML(score));
    expect(doc.querySelector("time > beats")?.textContent).toBe("3");
    const measures = doc.querySelectorAll("part > measure");
    expect(measures).toHaveLength(2);
    for (const measure of measures) {
      const sum = [...measure.querySelectorAll(":scope > note > duration")]
        .map((d) => Number(d.textContent))
        .reduce((s, d) => s + d, 0);
      expect(sum).toBe(12);
    }
    // The note crossing the barline is tied.
    expect(doc.querySelectorAll('tie[type="start"]').length).toBeGreaterThan(0);
  });

  it("spells accidentals against the key signature", () => {
    // F# in C major needs an explicit accidental.
    const score = makeScore([makePart([{ startTick: 0, durationTicks: 4, midi: 66 }])]);
    const doc = parse(toMusicXML(score));
    expect(doc.querySelector("accidental")?.textContent).toBe("sharp");
    expect(doc.querySelector("pitch > alter")?.textContent).toBe("1");
  });
});
