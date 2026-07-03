import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from "react";
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
  setTimeSig,
  togglePartMuted,
  togglePartSolo,
} from "../score/scoreOps";
import type { Mode, PartRole, RawNote, Score, TimeSignature } from "../score/types";

export type Action =
  | { type: "PART_RECORDED"; rawNotes: RawNote[]; role: PartRole; name: string }
  | { type: "PART_RERECORDED"; partId: string; rawNotes: RawNote[] }
  | { type: "PART_DELETED"; partId: string }
  | { type: "PART_RENAMED"; partId: string; name: string }
  | { type: "PART_MUTE_TOGGLED"; partId: string }
  | { type: "PART_SOLO_TOGGLED"; partId: string }
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_KEY"; selection: "auto" | { tonicPc: number; mode: Mode } }
  | { type: "SET_TIME_SIG"; beats: TimeSignature["beats"] }
  | { type: "SET_CHORDS_ENABLED"; enabled: boolean }
  | {
      type: "NOTE_EDITED";
      partId: string;
      noteIndex: number;
      patch: { deltaSemitones?: number; deltaTicks?: number; delete?: boolean };
    }
  | { type: "RESET" }
  | { type: "UNDO" }
  | { type: "REDO" };

function applyAction(score: Score, action: Action): Score {
  switch (action.type) {
    case "PART_RECORDED":
      return addPart(score, action.rawNotes, action.role, action.name);
    case "PART_RERECORDED":
      return replacePartRecording(score, action.partId, action.rawNotes);
    case "PART_DELETED":
      return deletePart(score, action.partId);
    case "PART_RENAMED":
      return renamePart(score, action.partId, action.name);
    case "PART_MUTE_TOGGLED":
      return togglePartMuted(score, action.partId);
    case "PART_SOLO_TOGGLED":
      return togglePartSolo(score, action.partId);
    case "SET_BPM":
      return setBpm(score, action.bpm);
    case "SET_KEY":
      return setKey(score, action.selection);
    case "SET_TIME_SIG":
      return setTimeSig(score, action.beats);
    case "SET_CHORDS_ENABLED":
      return setChordsEnabled(score, action.enabled);
    case "NOTE_EDITED":
      return editNote(score, action.partId, action.noteIndex, action.patch);
    case "RESET":
      return emptyScore();
    default:
      return score;
  }
}

export interface HistoryState {
  past: Score[];
  present: Score;
  future: Score[];
}

const HISTORY_LIMIT = 50;
/** Rapid-fire, low-stakes actions that shouldn't create undo steps. */
const NOT_UNDOABLE = new Set<Action["type"]>([
  "PART_RENAMED",
  "PART_MUTE_TOGGLED",
  "PART_SOLO_TOGGLED",
  "SET_CHORDS_ENABLED",
]);

export function historyReducer(state: HistoryState, action: Action): HistoryState {
  if (action.type === "UNDO") {
    if (state.past.length === 0) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1],
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "REDO") {
    if (state.future.length === 0) return state;
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  const next = applyAction(state.present, action);
  if (next === state.present) return state;
  if (NOT_UNDOABLE.has(action.type)) {
    return { ...state, present: next };
  }
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

const STORAGE_KEY = "humscore:score:v2";

function loadPersisted(): Score | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Score;
    if (!Array.isArray(parsed.parts) || typeof parsed.bpm !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function initHistory(): HistoryState {
  return { past: [], present: loadPersisted() ?? emptyScore(), future: [] };
}

const ScoreContext = createContext<Score | null>(null);
const HistoryContext = createContext<{ canUndo: boolean; canRedo: boolean } | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function ScoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(historyReducer, undefined, initHistory);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave.
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        if (state.present.parts.length === 0) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.present));
        }
      } catch {
        // Storage full or unavailable — losing autosave is acceptable.
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state.present]);

  return (
    <ScoreContext.Provider value={state.present}>
      <HistoryContext.Provider
        value={{ canUndo: state.past.length > 0, canRedo: state.future.length > 0 }}
      >
        <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
      </HistoryContext.Provider>
    </ScoreContext.Provider>
  );
}

export function useScore(): Score {
  const score = useContext(ScoreContext);
  if (!score) throw new Error("useScore outside ScoreProvider");
  return score;
}

export function useHistoryInfo(): { canUndo: boolean; canRedo: boolean } {
  const info = useContext(HistoryContext);
  if (!info) throw new Error("useHistoryInfo outside ScoreProvider");
  return info;
}

export function useScoreDispatch(): Dispatch<Action> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error("useScoreDispatch outside ScoreProvider");
  return dispatch;
}
