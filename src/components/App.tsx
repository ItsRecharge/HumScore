import { useState } from "react";
import { ScoreProvider } from "../state/store";
import PartsPanel from "./PartsPanel";
import RecordModal, { type RecordTarget } from "./RecordModal";
import ScoreView from "./ScoreView";
import Toolbar from "./Toolbar";

export default function App() {
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null);
  return (
    <ScoreProvider>
      <div className="flex h-full flex-col bg-slate-100 text-slate-900">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <PartsPanel onRecord={setRecordTarget} />
          <ScoreView />
        </div>
        {recordTarget && (
          <RecordModal target={recordTarget} onClose={() => setRecordTarget(null)} />
        )}
      </div>
    </ScoreProvider>
  );
}
