import { describe, expect, it } from "vitest";
import { emptyScore } from "../score/scoreOps";
import type { RawNote } from "../score/types";
import { historyReducer, type HistoryState } from "./store";

function raw(startSec: number, endSec: number, midi: number): RawNote {
  return { startSec, endSec, midi, midiFloat: midi, energy: 0.1 };
}

const MELODY = [raw(0, 0.45, 60), raw(0.5, 0.95, 64), raw(1.0, 1.45, 67), raw(1.5, 2.4, 72)];

function fresh(): HistoryState {
  return { past: [], present: emptyScore(), future: [] };
}

describe("historyReducer", () => {
  it("records undoable actions and undoes/redoes them", () => {
    let state = fresh();
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "melody",
      name: "Melody",
    });
    expect(state.present.parts).toHaveLength(1);
    expect(state.past).toHaveLength(1);

    state = historyReducer(state, { type: "UNDO" });
    expect(state.present.parts).toHaveLength(0);
    expect(state.future).toHaveLength(1);

    state = historyReducer(state, { type: "REDO" });
    expect(state.present.parts).toHaveLength(1);
    expect(state.future).toHaveLength(0);
  });

  it("does not create history entries for renames or mute toggles", () => {
    let state = fresh();
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "melody",
      name: "Melody",
    });
    const partId = state.present.parts[0].id;
    const pastLen = state.past.length;
    state = historyReducer(state, { type: "PART_RENAMED", partId, name: "Lead" });
    state = historyReducer(state, { type: "PART_MUTE_TOGGLED", partId });
    expect(state.present.parts[0].name).toBe("Lead");
    expect(state.present.parts[0].muted).toBe(true);
    expect(state.past).toHaveLength(pastLen);
  });

  it("clears the redo stack on a new action", () => {
    let state = fresh();
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "melody",
      name: "A",
    });
    state = historyReducer(state, { type: "UNDO" });
    expect(state.future).toHaveLength(1);
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "bass",
      name: "B",
    });
    expect(state.future).toHaveLength(0);
  });

  it("undo is a no-op with no history", () => {
    const state = fresh();
    expect(historyReducer(state, { type: "UNDO" })).toBe(state);
  });

  it("shifts a part along the grid and clamps at zero", () => {
    let state = fresh();
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "melody",
      name: "Melody",
    });
    const partId = state.present.parts[0].id;
    state = historyReducer(state, { type: "PART_SHIFTED", partId, deltaTicks: 4 });
    expect(state.present.parts[0].notes[0].startTick).toBe(4);
    // Shifting far left clamps at tick 0 instead of going negative.
    state = historyReducer(state, { type: "PART_SHIFTED", partId, deltaTicks: -16 });
    expect(state.present.parts[0].notes[0].startTick).toBe(0);
  });

  it("round-trips a project file through PROJECT_LOADED", () => {
    let state = fresh();
    state = historyReducer(state, {
      type: "PART_RECORDED",
      rawNotes: MELODY,
      role: "melody",
      name: "Melody",
    });
    const serialized = JSON.parse(JSON.stringify(state.present));
    let loaded = fresh();
    loaded = historyReducer(loaded, { type: "PROJECT_LOADED", data: serialized });
    expect(loaded.present.parts).toHaveLength(1);
    expect(loaded.present.bpm).toBe(state.present.bpm);
    // Garbage input is rejected, keeping the current score.
    const before = loaded.present;
    loaded = historyReducer(loaded, { type: "PROJECT_LOADED", data: { nope: true } });
    expect(loaded.present).toBe(before);
  });
});
