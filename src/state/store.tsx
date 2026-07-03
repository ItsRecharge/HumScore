import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import {
  addPart,
  deletePart,
  editNote,
  emptyScore,
  renamePart,
  replacePartRecording,
  setBpm,
  setChordsEnabled,
  setKey,
} from "../score/scoreOps";
import type { Mode, PartRole, RawNote, Score } from "../score/types";

export type Action =
  | { type: "PART_RECORDED"; rawNotes: RawNote[]; role: PartRole; name: string }
  | { type: "PART_RERECORDED"; partId: string; rawNotes: RawNote[] }
  | { type: "PART_DELETED"; partId: string }
  | { type: "PART_RENAMED"; partId: string; name: string }
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_KEY"; selection: "auto" | { tonicPc: number; mode: Mode } }
  | { type: "SET_CHORDS_ENABLED"; enabled: boolean }
  | {
      type: "NOTE_EDITED";
      partId: string;
      noteIndex: number;
      patch: { deltaSemitones?: number; delete?: boolean };
    }
  | { type: "RESET" };

export function scoreReducer(score: Score, action: Action): Score {
  switch (action.type) {
    case "PART_RECORDED":
      return addPart(score, action.rawNotes, action.role, action.name);
    case "PART_RERECORDED":
      return replacePartRecording(score, action.partId, action.rawNotes);
    case "PART_DELETED":
      return deletePart(score, action.partId);
    case "PART_RENAMED":
      return renamePart(score, action.partId, action.name);
    case "SET_BPM":
      return setBpm(score, action.bpm);
    case "SET_KEY":
      return setKey(score, action.selection);
    case "SET_CHORDS_ENABLED":
      return setChordsEnabled(score, action.enabled);
    case "NOTE_EDITED":
      return editNote(score, action.partId, action.noteIndex, action.patch);
    case "RESET":
      return emptyScore();
  }
}

const ScoreContext = createContext<Score | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function ScoreProvider({ children }: { children: ReactNode }) {
  const [score, dispatch] = useReducer(scoreReducer, undefined, emptyScore);
  return (
    <ScoreContext.Provider value={score}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </ScoreContext.Provider>
  );
}

export function useScore(): Score {
  const score = useContext(ScoreContext);
  if (!score) throw new Error("useScore outside ScoreProvider");
  return score;
}

export function useScoreDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error("useScoreDispatch outside ScoreProvider");
  return dispatch;
}
