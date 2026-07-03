import { useEffect, useRef, useState } from "react";
import { downloadMidi, downloadMusicXML } from "../export/downloads";
import { Player } from "../playback/player";
import {
  PITCH_CLASS_NAMES_FLAT,
  PITCH_CLASS_NAMES_SHARP,
  type Mode,
} from "../score/types";
import { fifthsFor } from "../theory/key";
import { useScore, useScoreDispatch } from "../state/store";

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

export default function Toolbar() {
  const score = useScore();
  const dispatch = useScoreDispatch();
  const [bpmInput, setBpmInput] = useState(String(score.bpm));
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => setBpmInput(String(score.bpm)), [score.bpm]);

  // Stop playback whenever the score changes underneath it.
  useEffect(() => {
    if (playerRef.current?.isPlaying) {
      playerRef.current.stop();
      setPlaying(false);
    }
  }, [score]);

  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const hasParts = score.parts.length > 0;
  const bpmValue = Number(bpmInput);
  const bpmValid = Number.isFinite(bpmValue) && bpmValue >= 40 && bpmValue <= 220;
  const bpmDirty = bpmValid && Math.round(bpmValue) !== score.bpm;
  const tempoUncertain =
    hasParts && score.bpmSource === "inferred" && score.tempoConfidence < 0.15;

  const togglePlay = async () => {
    if (!playerRef.current) playerRef.current = new Player();
    const player = playerRef.current;
    if (playing) {
      player.stop();
      setPlaying(false);
    } else {
      player.load(score);
      setPlaying(true);
      await player.play(() => setPlaying(false));
    }
  };

  const keyValue =
    score.keySource === "inferred" ? "auto" : `${score.key.tonicPc}:${score.key.mode}`;

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <h1 className="mr-2 text-lg font-bold tracking-tight text-indigo-700">
        Hum<span className="text-slate-800">Score</span>
      </h1>

      <div className="flex items-center gap-1.5">
        <label htmlFor="bpm" className="text-xs font-medium text-slate-500">
          BPM
        </label>
        <input
          id="bpm"
          type="number"
          min={40}
          max={220}
          value={bpmInput}
          onChange={(e) => setBpmInput(e.target.value)}
          disabled={!hasParts}
          className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums disabled:bg-slate-50 disabled:text-slate-400"
        />
        {tempoUncertain && (
          <span
            title="Tempo detection was uncertain — consider setting the BPM manually."
            className="h-2 w-2 rounded-full bg-amber-400"
          />
        )}
        <button
          onClick={() => dispatch({ type: "SET_BPM", bpm: Math.round(bpmValue) })}
          disabled={!bpmDirty}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 enabled:hover:bg-slate-50 disabled:opacity-40"
        >
          Re-quantize
        </button>
      </div>

      <div className="flex items-center gap-1.5">
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
          onClick={() => void togglePlay()}
          disabled={!hasParts}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white enabled:hover:bg-indigo-700 disabled:opacity-40"
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
