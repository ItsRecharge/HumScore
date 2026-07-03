import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import { useEffect, useMemo, useRef, useState } from "react";
import { player } from "../playback/player";
import { toMusicXML } from "../score/musicxml";
import { useScore } from "../state/store";

/** Advance the OSMD cursor to the entry at/after the given whole-note time. */
function seekCursor(osmd: OpenSheetMusicDisplay, targetWholeNotes: number): void {
  const cursor = osmd.cursor;
  if (!cursor) return;
  let guard = 0;
  while (guard++ < 500) {
    // Property casing has varied across OSMD versions — probe defensively.
    const it = cursor.iterator as unknown as {
      EndReached?: boolean;
      currentTimeStamp?: { RealValue?: number };
      CurrentEnrolledTimestamp?: { RealValue?: number };
    };
    if (!it || it.EndReached) break;
    const v = it.currentTimeStamp?.RealValue ?? it.CurrentEnrolledTimestamp?.RealValue;
    if (v === undefined || v >= targetWholeNotes) break;
    cursor.next();
  }
}

export default function ScoreView() {
  const score = useScore();
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  // OSMD corrupts state if load() calls overlap — serialize them.
  const loadChainRef = useRef<Promise<void>>(Promise.resolve());
  const [renderError, setRenderError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(player.isPlaying);

  const xml = useMemo(
    () => (score.parts.length > 0 ? toMusicXML(score) : null),
    [score],
  );

  useEffect(() => {
    const container = containerRef.current;
    return () => {
      osmdRef.current = null;
      if (container) container.innerHTML = "";
    };
  }, []);

  useEffect(() => {
    if (!xml || !containerRef.current) return;
    if (!osmdRef.current) {
      osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        backend: "svg",
        drawTitle: false,
      });
    }
    const osmd = osmdRef.current;
    loadChainRef.current = loadChainRef.current
      .then(async () => {
        if (osmdRef.current !== osmd) return;
        await osmd.load(xml);
        osmd.render();
        setRenderError(null);
      })
      .catch((err: unknown) => {
        console.error("OSMD render failed", err);
        setRenderError(err instanceof Error ? err.message : String(err));
      });
  }, [xml]);

  useEffect(() => player.onStateChange(setPlaying), []);

  // Playback cursor: follow the transport with a rAF loop.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!playing || !osmd) return;
    try {
      osmd.cursor?.reset();
      osmd.cursor?.show();
    } catch {
      return; // cursor unavailable — skip silently
    }
    let raf = 0;
    const loop = () => {
      const tick = player.positionTick;
      if (tick !== null) {
        try {
          seekCursor(osmd, tick / 16); // 1 tick = 1/16 whole note
        } catch {
          return; // stop following on any cursor error
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      try {
        osmd.cursor?.hide();
      } catch {
        /* ignore */
      }
    };
  }, [playing]);

  return (
    <main className="relative flex-1 overflow-auto bg-white">
      {score.parts.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <div className="mb-2 text-4xl">🎤</div>
            <h2 className="mb-1 text-lg font-semibold text-slate-800">
              Record your first part
            </h2>
            <p className="text-sm text-slate-500">
              Hum a melody in the panel on the left. HumScore will figure out
              the notes, tempo and key, and put it on a staff.
            </p>
          </div>
        </div>
      )}
      {renderError && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Could not render the score: {renderError}
        </div>
      )}
      <div ref={containerRef} className="p-6" />
    </main>
  );
}
