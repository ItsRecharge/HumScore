import { auditionNote } from "../playback/player";
import { midiToName, type Part } from "../score/types";
import { useScoreDispatch } from "../state/store";

/** Note editing: audition, nudge pitch, stretch/shrink duration, delete. */
export default function PartEditor({ part }: { part: Part }) {
  const dispatch = useScoreDispatch();
  if (part.notes.length === 0) {
    return <p className="px-2 py-1 text-xs text-slate-400">No notes.</p>;
  }
  const edit = (noteIndex: number, patch: { deltaSemitones?: number; deltaTicks?: number; delete?: boolean }) =>
    dispatch({ type: "NOTE_EDITED", partId: part.id, noteIndex, patch });
  const shift = (deltaTicks: number) =>
    dispatch({ type: "PART_SHIFTED", partId: part.id, deltaTicks });
  const shiftBtn =
    "rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100";

  return (
    <div className="max-h-56 overflow-auto">
      <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
        <span className="mr-1 text-[11px] text-slate-400">Shift part</span>
        <button onClick={() => shift(-4)} className={shiftBtn} title="Earlier by one beat">
          ◀ beat
        </button>
        <button onClick={() => shift(-1)} className={shiftBtn} title="Earlier by a sixteenth">
          ◀
        </button>
        <button onClick={() => shift(1)} className={shiftBtn} title="Later by a sixteenth">
          ▶
        </button>
        <button onClick={() => shift(4)} className={shiftBtn} title="Later by one beat">
          beat ▶
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="px-2 py-1 font-medium">Note</th>
            <th className="px-2 py-1 font-medium">Beat</th>
            <th className="px-2 py-1 font-medium">Len</th>
            <th className="px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {part.notes.map((n, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1">
                <button
                  onClick={() => void auditionNote(n.midi)}
                  className="rounded px-1 font-mono text-slate-700 hover:bg-indigo-50"
                  title="Click to hear"
                >
                  {midiToName(n.midi)}
                </button>
              </td>
              <td className="px-2 py-1 tabular-nums text-slate-500">
                {(n.startTick / 4 + 1).toFixed(2).replace(/\.?0+$/, "")}
              </td>
              <td className="px-2 py-1">
                <div className="flex items-center gap-0.5 tabular-nums text-slate-500">
                  <button
                    title="Shorter (one sixteenth)"
                    onClick={() => edit(i, { deltaTicks: -1 })}
                    disabled={n.durationTicks <= 1}
                    className="rounded px-1 text-slate-400 enabled:hover:bg-slate-100 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-7 text-center">{n.durationTicks / 4}</span>
                  <button
                    title="Longer (one sixteenth)"
                    onClick={() => edit(i, { deltaTicks: 1 })}
                    className="rounded px-1 text-slate-400 hover:bg-slate-100"
                  >
                    ＋
                  </button>
                </div>
              </td>
              <td className="px-2 py-1">
                <div className="flex justify-end gap-1">
                  <button
                    title="Down a semitone"
                    onClick={() => edit(i, { deltaSemitones: -1 })}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100"
                  >
                    ♭
                  </button>
                  <button
                    title="Up a semitone"
                    onClick={() => edit(i, { deltaSemitones: 1 })}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100"
                  >
                    ♯
                  </button>
                  <button
                    title="Delete note"
                    onClick={() => edit(i, { delete: true })}
                    className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-50"
                  >
                    ✕
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
