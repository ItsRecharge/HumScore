import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { ScoreProvider } from "../state/store";
import PartsPanel from "./PartsPanel";
import RecordModal, { type RecordTarget } from "./RecordModal";
import Toolbar from "./Toolbar";

// OSMD is by far the largest dependency — keep it out of the main chunk.
const ScoreView = lazy(() => import("./ScoreView"));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-slate-100 p-8">
          <div className="max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow">
            <div className="mb-2 text-3xl">😵</div>
            <h2 className="mb-1 font-semibold text-slate-800">Something went wrong</h2>
            <p className="mb-4 text-sm text-slate-500">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Reload — your score is saved locally
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null);
  return (
    <ErrorBoundary>
      <ScoreProvider>
        <div className="flex h-full flex-col bg-slate-100 text-slate-900">
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            <PartsPanel onRecord={setRecordTarget} />
            <Suspense
              fallback={
                <main className="flex flex-1 items-center justify-center bg-white text-sm text-slate-400">
                  Loading notation engine…
                </main>
              }
            >
              <ScoreView />
            </Suspense>
          </div>
          {recordTarget && (
            <RecordModal target={recordTarget} onClose={() => setRecordTarget(null)} />
          )}
        </div>
      </ScoreProvider>
    </ErrorBoundary>
  );
}
