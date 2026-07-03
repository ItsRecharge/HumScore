import { useCallback, useEffect, useRef, useState } from "react";
import { downloadMidi, downloadMusicXML, downloadProject } from "../export/downloads";
import { player } from "../playback/player";
import {
  PITCH_CLASS_NAMES_FLAT,
  PITCH_CLASS_NAMES_SHARP,
  type Mode,
  type TimeSignature,
} from "../score/types";
import { fifthsFor } from "../theory/key";
import { useHistoryInfo, useScore, useScoreDispatch } from "../state/store";

function keyName(tonicPc: number, mode: Mode): string {
  const fifths = fifthsFor(tonicPc, mode);
  const names = fifths < 0 ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP;
  return `${names[tonicPc]} ${mode}`;
}

const KEY_OPTIONS: { value: string; label: string }[] = [];
for (const mode of ["major", "minor"] as const) {
  for (let pc = 0; pc < 12; pc++) {
    KEY_OPTIONS.push({ value: `${pc}:${mode}`, label: keyName(pc, mode) });
  }
}

const MIN_BPM = 40;
const MAX_BPM = 220;

export default function Toolbar() {
  const score = useScore();
  const dispatch = useScoreDispatch();
  const { canUndo, canRedo } = useHistoryInfo();
  const [bpmInput, setBpmInput] = useState(String(score.bpm));
  const [playing, setPlaying] = useState(player.isPlaying);
  const tapTimesRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openProject = async (file: File) => {
    try {
      dispatch({ type: "PROJECT_LOADED", data: JSON.parse(await file.text()) });
    } catch {
      window.alert("That file doesn't look like a HumScore project.");
    }
  };

  useEffect(() => setBpmInput(String(score.bpm)), [score.bpm]);
  useEffect(() => player.onStateChange(setPlaying), []);

  // Stop playback whenever the score changes underneath it.
  useEffect(() => {
    if (player.isPlaying) player.stop();
  }, [score]);

  const hasParts = score.parts.length > 0;
  const bpmValue = Number(bpmInput);
  const bpmValid = Number.isFinite(bpmValue) && bpmValue >= MIN_BPM && bpmValue <= MAX_BPM;
  const bpmDirty = bpmValid && Math.round(bpmValue) !== score.bpm;
  const tempoUncertain =
    hasParts && score.bpmSource === "inferred" && score.tempoConfidence < 0.15;

  const togglePlay = useCallback(async () => {
    if (player.isPlaying) {
      player.stop();
    } else if (score.parts.length > 0) {
      await player.play(score);
    }
  }, [score]);

  // Keyboard shortcuts: Space = play/stop, Ctrl+Z / Ctrl+Y = undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        void togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, togglePlay]);

  const tapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((s, x) => s + x, 0) / intervals.length;
      const bpm = Math.round(60000 / avg);
      setBpmInput(String(Math.max(MIN_BPM, Math.min(MAX_BPM, bpm))));
    }
  };

  const scaleBpm = (factor: number) => {
    const next = Math.round(score.bpm * factor);
    if (next >= MIN_BPM && next <= MAX_BPM) dispatch({ type: "SET_BPM", bpm: next });
  };

  const keyValue =
    score.keySource === "inferred" ? "auto" : `${score.key.tonicPc}:${score.key.mode}`;

  const smallBtn =
    "whitespace-nowrap rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40";

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2.5 border-b border-slate-200 bg-white px-4 print:hidden">
      <h1 className="text-lg font-bold tracking-tight text-indigo-700">
        Hum<span className="text-slate-800">Score</span>
      </h1>
      <input
        aria-label="Score title"
        value={score.title}
        onChange={(e) => dispatch({ type: "SET_TITLE", title: e.target.value })}
        className="w-32 rounded-lg border border-transparent px-2 py-1 text-sm font-medium text-slate-700 hover:border-slate-200 focus:border-indigo-300 focus:outline-none"
        placeholder="Untitled"
      />

      <div className="flex items-center gap-1">
        <label htmlFor="bpm" className="text-xs font-medium text-slate-500">
          BPM
        </label>
        <input
          id="bpm"
          type="number"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpmInput}
          onChange={(e) => setBpmInput(e.target.value)}
          disabled={!hasParts}
          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
        />
        {tempoUncertain && (
          <span
            title="Tempo detection was uncertain — consider setting the BPM manually (try Tap), or ÷2/×2 if it's off by an octave."
            className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
          />
        )}
        <button
          onClick={() => dispatch({ type: "SET_BPM", bpm: Math.round(bpmValue) })}
          disabled={!bpmDirty}
          className={smallBtn}
        >
          Re-quantize
        </button>
        <button onClick={tapTempo} disabled={!hasParts} className={smallBtn} title="Tap the beat to measure a tempo">
          Tap
        </button>
        <button onClick={() => scaleBpm(0.5)} disabled={!hasParts || score.bpm / 2 < MIN_BPM} className={smallBtn} title="Halve the tempo (fixes double-time detection)">
          ÷2
        </button>
        <button onClick={() => scaleBpm(2)} disabled={!hasParts || score.bpm * 2 > MAX_BPM} className={smallBtn} title="Double the tempo (fixes half-time detection)">
          ×2
        </button>
      </div>

      <div className="flex items-center gap-1">
        <label htmlFor="key" className="text-xs font-medium text-slate-500">
          Key
        </label>
        <select
          id="key"
          value={keyValue}
          disabled={!hasParts}
          onChange={(e) => {
            if (e.target.value === "auto") {
              dispatch({ type: "SET_KEY", selection: "auto" });
            } else {
              const [pc, mode] = e.target.value.split(":");
              dispatch({
                type: "SET_KEY",
                selection: { tonicPc: Number(pc), mode: mode as Mode },
              });
            }
          }}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="auto">
            Auto{hasParts ? ` (${keyName(score.key.tonicPc, score.key.mode)})` : ""}
          </option>
          {KEY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <select
        aria-label="Time signature"
        value={score.timeSig.beats}
        disabled={!hasParts}
        onChange={(e) =>
          dispatch({ type: "SET_TIME_SIG", beats: Number(e.target.value) as TimeSignature["beats"] })
        }
        className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        title="Time signature"
      >
        <option value={4}>4/4</option>
        <option value={3}>3/4</option>
        <option value={2}>2/4</option>
      </select>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-500">
        <input
          type="checkbox"
          checked={score.chordsEnabled}
          onChange={(e) => dispatch({ type: "SET_CHORDS_ENABLED", enabled: e.target.checked })}
          className="accent-indigo-600"
        />
        Chords
      </label>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={!canUndo}
          className={smallBtn}
          title="Undo (Ctrl+Z)"
        >
          ↩
        </button>
        <button
          onClick={() => dispatch({ type: "REDO" })}
          disabled={!canRedo}
          className={smallBtn}
          title="Redo (Ctrl+Y)"
        >
          ↪
        </button>
        <button
          onClick={() => void togglePlay()}
          disabled={!hasParts}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white enabled:hover:bg-indigo-700 disabled:opacity-40"
          title="Play/stop (Space)"
        >
          {playing ? "■ Stop" : "▶ Play"}
        </button>
        <button
          onClick={() => downloadMusicXML(score)}
          disabled={!hasParts}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
        >
          MusicXML
        </button>
        <button
          onClick={() => downloadMidi(score)}
          disabled={!hasParts}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
        >
          MIDI
        </button>
        <button
          onClick={() => window.print()}
          disabled={!hasParts}
          className={smallBtn}
          title="Print the score"
        >
          🖨
        </button>
        <button
          onClick={() => downloadProject(score)}
          disabled={!hasParts}
          className={smallBtn}
          title="Save project file (includes recordings)"
        >
          💾
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className={smallBtn}
          title="Open a saved project file"
        >
          📂
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openProject(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => {
            if (window.confirm("Start over? This deletes all recorded parts.")) {
              dispatch({ type: "RESET" });
            }
          }}
          disabled={!hasParts}
          className="rounded-lg px-2 py-1.5 text-sm text-slate-400 enabled:hover:bg-slate-50 disabled:opacity-40"
          title="Start over"
        >
          ↺
        </button>
      </div>
    </header>
  );
}
