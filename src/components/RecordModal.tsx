import { useCallback, useEffect, useRef, useState } from "react";
import { detectNotes } from "../audio/detectNotes";
import { Recorder } from "../audio/recorder";
import { startBacking, type Backing } from "../playback/player";
import { addPart, replacePartRecording } from "../score/scoreOps";
import {
  PITCH_CLASS_NAMES_FLAT,
  PITCH_CLASS_NAMES_SHARP,
  midiToName,
  type PartRole,
  type RawNote,
  type Score,
} from "../score/types";
import { useScore, useScoreDispatch } from "../state/store";
import LevelMeter from "./LevelMeter";

export type RecordTarget =
  | { mode: "new"; role: PartRole; name: string }
  | { mode: "rerecord"; partId: string; name: string };

type Phase =
  | { kind: "arming" }
  | { kind: "countdown"; n: number }
  | { kind: "recording" }
  | { kind: "processing" }
  | { kind: "preview"; raw: RawNote[]; next: Score }
  | { kind: "error"; message: string };

const MAX_RECORD_SEC = 60;
const COUNTDOWN_STEP_MS = 700;

function keyLabel(score: Score): string {
  const names = score.key.fifths < 0 ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP;
  return `${names[score.key.tonicPc]} ${score.key.mode}`;
}

/** Compact pitch/time visualization of the detected notes. */
function PianoRoll({ notes }: { notes: RawNote[] }) {
  if (notes.length === 0) return null;
  const t0 = notes[0].startSec;
  const t1 = Math.max(...notes.map((n) => n.endSec));
  const lo = Math.min(...notes.map((n) => n.midi)) - 1;
  const hi = Math.max(...notes.map((n) => n.midi)) + 1;
  const W = 360;
  const H = Math.min(120, Math.max(48, (hi - lo) * 8));
  const x = (t: number) => ((t - t0) / Math.max(0.001, t1 - t0)) * W;
  const y = (m: number) => H - ((m - lo) / (hi - lo)) * H;
  const rowH = H / (hi - lo);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded border border-slate-200 bg-slate-50"
      role="img"
      aria-label="Detected notes"
    >
      {notes.map((n, i) => (
        <g key={i}>
          <rect
            x={x(n.startSec)}
            y={y(n.midi) - rowH / 2}
            width={Math.max(2, x(n.endSec) - x(n.startSec) - 1)}
            height={Math.max(3, rowH * 0.8)}
            rx={2}
            className="fill-indigo-500"
          />
          <title>
            {midiToName(n.midi)} · {(n.endSec - n.startSec).toFixed(2)}s
          </title>
        </g>
      ))}
    </svg>
  );
}

export default function RecordModal({
  target,
  onClose,
}: {
  target: RecordTarget;
  onClose: () => void;
}) {
  const score = useScore();
  const dispatch = useScoreDispatch();
  const [phase, setPhase] = useState<Phase>({ kind: "arming" });
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<Recorder | null>(null);
  const backingRef = useRef<Backing | null>(null);
  const trimSecRef = useRef(0);
  const [attempt, setAttempt] = useState(0);

  // Parts that will play as the backing track (everything but the one being
  // re-recorded). Their existence is what makes this an overdub.
  const backingParts = score.parts.filter(
    (p) => !(target.mode === "rerecord" && p.id === target.partId),
  );
  const isOverdub = backingParts.length > 0;
  const isFirstGridSetter = !isOverdub;

  const stopAndProcess = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    backingRef.current?.stop();
    backingRef.current = null;
    setPhase({ kind: "processing" });
    try {
      const { pcm, sampleRate } = await recorder.stop();
      // Discard everything captured before recording "really" started
      // (countdown/count-in — including any click bleed from the speakers).
      const startSample = Math.min(pcm.length, Math.floor(trimSecRef.current * sampleRate));
      const raw = detectNotes(pcm.subarray(startSample), sampleRate);
      if (raw.length === 0) {
        setPhase({
          kind: "error",
          message:
            "We couldn't hear a melody in that take. Check your input level and hum a little louder, with clear separate notes.",
        });
        return;
      }
      const next =
        target.mode === "new"
          ? addPart(score, raw, target.role, target.name)
          : replacePartRecording(score, target.partId, raw);
      setPhase({ kind: "preview", raw, next });
    } catch (err) {
      setPhase({
        kind: "error",
        message: `Something went wrong while analyzing the recording: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }, [score, target]);

  // Arm mic → countdown (clicks + backing when overdubbing) → record.
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "arming" });
    setElapsed(0);
    setLevel(0);
    trimSecRef.current = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = async () => {
      const recorder = new Recorder();
      try {
        await recorder.start((rms) => setLevel(rms));
      } catch {
        recorder.dispose();
        if (!cancelled) {
          setPhase({
            kind: "error",
            message:
              "Microphone access was denied or unavailable. Allow microphone access for this site and try again.",
          });
        }
        return;
      }
      if (cancelled) {
        recorder.dispose();
        return;
      }
      recorderRef.current = recorder;
      const captureStartedAt = performance.now();

      if (isOverdub) {
        const countInBeats = score.timeSig.beats;
        setPhase({ kind: "countdown", n: countInBeats });
        try {
          const backing = await startBacking(
            { ...score, parts: backingParts },
            {
              countInBeats,
              maxSec: MAX_RECORD_SEC,
              onCountBeat: (n) => {
                if (!cancelled) setPhase({ kind: "countdown", n });
              },
            },
          );
          if (cancelled) {
            backing.stop();
            return;
          }
          backingRef.current = backing;
        } catch {
          // Backing is best-effort; recording still works without it.
        }
        trimSecRef.current = (performance.now() - captureStartedAt) / 1000;
        if (!cancelled) setPhase({ kind: "recording" });
      } else {
        for (let n = 3; n >= 1; n--) {
          timers.push(
            setTimeout(() => {
              if (!cancelled) setPhase({ kind: "countdown", n });
            }, (3 - n) * COUNTDOWN_STEP_MS),
          );
        }
        timers.push(
          setTimeout(() => {
            trimSecRef.current = (performance.now() - captureStartedAt) / 1000;
            if (!cancelled) setPhase({ kind: "recording" });
          }, 3 * COUNTDOWN_STEP_MS),
        );
      }
    };
    void run();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      backingRef.current?.stop();
      backingRef.current = null;
      recorderRef.current?.dispose();
      recorderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Elapsed timer + hard cap while recording.
  const isRecording = phase.kind === "recording";
  useEffect(() => {
    if (!isRecording) return;
    const startedAt = performance.now();
    const interval = setInterval(() => {
      const sec = (performance.now() - startedAt) / 1000;
      setElapsed(sec);
      if (sec >= MAX_RECORD_SEC) void stopAndProcess();
    }, 200);
    return () => clearInterval(interval);
  }, [isRecording, stopAndProcess]);

  const accept = () => {
    if (phase.kind !== "preview") return;
    if (target.mode === "new") {
      dispatch({ type: "PART_RECORDED", rawNotes: phase.raw, role: target.role, name: target.name });
    } else {
      dispatch({ type: "PART_RERECORDED", partId: target.partId, rawNotes: phase.raw });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">
          {target.mode === "new" ? `Record ${target.name}` : `Re-record ${target.name}`}
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          {isFirstGridSetter
            ? "This take sets the tempo and key for the whole score."
            : `You'll hear a ${score.timeSig.beats}-beat count-in, then the other parts at ${score.bpm} BPM — hum along. 🎧 Headphones recommended.`}
        </p>

        {phase.kind === "arming" && (
          <div className="flex flex-col items-center gap-2 py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-200 border-t-slate-500" />
            <p className="text-sm text-slate-500">Getting the microphone ready…</p>
          </div>
        )}

        {phase.kind === "countdown" && (
          <div className="flex flex-col items-center gap-2 py-8">
            <div className="text-6xl font-bold tabular-nums text-indigo-600">{phase.n}</div>
            <p className="text-sm text-slate-500">
              {isOverdub ? "Count-in — hum on the next downbeat…" : "Get ready to hum…"}
            </p>
          </div>
        )}

        {phase.kind === "recording" && (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="text-sm font-medium text-slate-700">
                Recording… {elapsed.toFixed(0)}s / {MAX_RECORD_SEC}s
              </span>
            </div>
            <LevelMeter rms={level} />
            <button
              onClick={() => void stopAndProcess()}
              className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
            >
              ■ Stop
            </button>
          </div>
        )}

        {phase.kind === "processing" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="text-sm text-slate-500">Transcribing your hum…</p>
          </div>
        )}

        {phase.kind === "preview" && (
          <div className="flex flex-col gap-3 py-2">
            <div className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900">
              <span className="font-semibold">{phase.raw.length} notes</span>
              {" · "}
              {phase.next.bpm} BPM
              {isFirstGridSetter &&
                (phase.next.tempoConfidence >= 0.15
                  ? " (confident)"
                  : " (uncertain — you can set BPM manually)")}
              {" · "}
              {keyLabel(phase.next)}
            </div>
            <PianoRoll notes={phase.raw} />
            <div className="flex gap-2">
              <button
                onClick={accept}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
              >
                Accept
              </button>
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
              >
                Retry
              </button>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 font-medium text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase.kind === "error" && (
          <div className="flex flex-col gap-4 py-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {phase.message}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700"
              >
                Try again
              </button>
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 font-medium text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {(phase.kind === "arming" || phase.kind === "countdown" || phase.kind === "recording") && (
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-lg px-4 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
