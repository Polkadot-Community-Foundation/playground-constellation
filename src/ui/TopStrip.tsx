export interface Totals {
  apps: number;
  stars: number;
  xp: number;
}

export function TopStrip({ totals, live }: { totals: Totals; live: boolean }) {
  return (
    <div className="top-strip">
      <span className="top-title">Web3 Summit · Playground · Berlin '26</span>
      <span className="top-stats">
        <span>{totals.apps} apps</span>
        <span>{totals.stars} stars</span>
        <span className={live ? "live on" : "live"}>{live ? "LIVE" : "CONNECTING"}</span>
      </span>
    </div>
  );
}
