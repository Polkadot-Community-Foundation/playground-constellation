import type { FeedEntry } from "../model/format.ts";

export type { FeedEntry };

export function EventFeed({ entries }: { entries: FeedEntry[] }) {
  return (
    <div className="feed">
      <div className="feed-head">Live event feed</div>
      <div className="feed-rows">
        {entries.map((e) => (
          <div className="feed-row" key={e.id}>
            <span className="feed-ts">{e.time}</span>{" "}
            <span className="feed-tag">[{e.line.tag}]</span>
            <div className="feed-body">
              <span className="feed-actor">{e.line.actorLabel}</span>{" "}
              <span className="feed-sym">{e.line.symbol}</span>{" "}
              <span className="feed-target">{e.line.targetLabel}</span>
              {e.line.xp != null && <span className="feed-xp"> +{e.line.xp}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
