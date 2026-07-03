/** Simple horizontal input-level bar driven by RMS values (0..~0.5). */
export default function LevelMeter({ rms }: { rms: number }) {
  // Map RMS to a perceptual-ish 0..100% width.
  const pct = Math.min(100, Math.round(Math.sqrt(Math.min(1, rms * 6)) * 100));
  const color = pct > 80 ? "bg-red-500" : pct > 15 ? "bg-emerald-500" : "bg-slate-400";
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-full rounded-full transition-[width] duration-75 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
