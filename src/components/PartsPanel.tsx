import { useState } from "react";
import type { PartRole } from "../score/types";
import { useScore, useScoreDispatch } from "../state/store";
import PartEditor from "./PartEditor";
import type { RecordTarget } from "./RecordModal";

const ROLE_META: Record<PartRole, { label: string; badge: string }> = {
  melody: { label: "Melody", badge: "bg-indigo-100 text-indigo-700" },
  bass: { label: "Bass", badge: "bg-emerald-100 text-emerald-700" },
  counter: { label: "Counter", badge: "bg-amber-100 text-amber-700" },
};

export default function PartsPanel({
  onRecord,
}: {
  onRecord: (target: RecordTarget) => void;
}) {
  const score = useScore();
  const dispatch = useScoreDispatch();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const defaultName = (role: PartRole) => {
    const base = role === "counter" ? "Countermelody" : ROLE_META[role].label;
    const taken = score.parts.filter((p) => p.name.startsWith(base)).length;
    return taken === 0 ? base : `${base} ${taken + 1}`;
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 print:hidden">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Parts</h2>
        {score.parts.length === 0 && (
          <p className="mt-1 text-xs text-slate-400">
            Your first part sets the tempo &amp; key.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {score.parts.map((part) => (
          <div key={part.id} className="border-b border-slate-200 bg-white">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <input
                  value={part.name}
                  onChange={(e) =>
                    dispatch({ type: "PART_RENAMED", partId: part.id, name: e.target.value })
                  }
                  className="w-full truncate rounded bg-transparent px-1 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:bg-white focus:outline focus:outline-indigo-300"
                />
                <div className="mt-0.5 flex items-center gap-2 px-1">
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-medium ${ROLE_META[part.role].badge}`}
                  >
                    {ROLE_META[part.role].label}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {part.notes.length} notes · {part.clef} clef
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 px-3 pb-2">
              <button
                onClick={() => dispatch({ type: "PART_MUTE_TOGGLED", partId: part.id })}
                className={`rounded px-1.5 py-1 text-[11px] font-semibold ${
                  part.muted
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-slate-100"
                }`}
                title={part.muted ? "Unmute" : "Mute"}
              >
                M
              </button>
              <button
                onClick={() => dispatch({ type: "PART_SOLO_TOGGLED", partId: part.id })}
                className={`rounded px-1.5 py-1 text-[11px] font-semibold ${
                  part.solo
                    ? "bg-amber-400 text-white"
                    : "text-slate-400 hover:bg-slate-100"
                }`}
                title={part.solo ? "Unsolo" : "Solo"}
              >
                S
              </button>
              <button
                onClick={() =>
                  onRecord({ mode: "rerecord", partId: part.id, name: part.name })
                }
                className="whitespace-nowrap rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
                title="Re-record this part"
              >
                🎤 Rec
              </button>
              <button
                onClick={() => setExpandedId(expandedId === part.id ? null : part.id)}
                className="whitespace-nowrap rounded px-1.5 py-1 text-xs text-slate-600 hover:bg-slate-100"
              >
                ✏️ Edit
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete part "${part.name}"?`)) {
                    dispatch({ type: "PART_DELETED", partId: part.id });
                  }
                }}
                className="ml-auto rounded px-1.5 py-1 text-xs text-red-500 hover:bg-red-50"
                title="Delete part"
              >
                🗑
              </button>
            </div>
            {expandedId === part.id && (
              <div className="border-t border-slate-100 bg-slate-50">
                <PartEditor part={part} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 p-3">
        <p className="mb-2 text-xs font-medium text-slate-500">Add a part — hum it:</p>
        <div className="flex flex-col gap-1.5">
          {(Object.keys(ROLE_META) as PartRole[]).map((role) => (
            <button
              key={role}
              onClick={() => onRecord({ mode: "new", role, name: defaultName(role) })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
            >
              ＋ {ROLE_META[role].label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
