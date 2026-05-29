import type { LoadProgress } from "../chain/source.ts";

export function LoadingProgress({ progress }: { progress: LoadProgress | null }) {
  if (!progress) return null;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="loading">
      <div className="loading-label">{progress.label}…</div>
      <div className="loading-bar">
        <div className="loading-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-count">
        {progress.done} / {progress.total}
      </div>
    </div>
  );
}
