import { useCallback, useEffect, useRef, useState } from "react";
import { saveGraph, loadGraph, saveFeed, loadFeed } from "./chain/cache.ts";
import { selectSources, type SourceMode } from "./chain/select.ts";
import type {
  ConstellationHandlers,
  Highlight,
  LoadProgress,
  RelabelEvent,
} from "./chain/source.ts";
import { effectsForEvent, type Effect } from "./graph/effects.ts";
import { ConstellationCanvas, type HoverInfo } from "./graph/ConstellationCanvas.tsx";
import { Legend } from "./ui/Legend.tsx";
import { NodeTooltip } from "./ui/NodeTooltip.tsx";
import { MAX_NODES } from "./config.ts";
import {
  applyEvent,
  applySnapshot,
  computeTotals,
  createGraph,
  pruneGraph,
  relabelBuilder,
  type Graph,
  type Totals,
} from "./model/graph.ts";
import {
  describeEvent,
  headlineFor,
  seedFeed,
  type FeedEntry,
  type FeedLine,
} from "./model/format.ts";
import { EventFeed } from "./ui/EventFeed.tsx";
import { Headline } from "./ui/Headline.tsx";
import { LoadingProgress } from "./ui/LoadingProgress.tsx";
import { TopStrip } from "./ui/TopStrip.tsx";

// Keep a generous buffer; the feed column flexes and clips the oldest, so
// larger screens show more without leaving empty space at the bottom.
const FEED_SIZE = 24;
const CACHE_THROTTLE_MS = 3000;
// Highlights only take over the big headline during quiet stretches — when a
// live event happened within this window the headline stays "live".
const HEADLINE_QUIET_MS = 10_000;

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

function highlightToLine(h: Highlight): FeedLine {
  return {
    tag: "HIGHLIGHT",
    actorLabel: "",
    symbol: "★",
    targetLabel: h.feedLabel,
  };
}

/** Keep existing (live/cached) entries on top; fill the rest with unseen seeds. */
function mergeFeed(existing: FeedEntry[], seed: FeedEntry[], cap: number): FeedEntry[] {
  if (existing.length >= cap) return existing.slice(0, cap);
  const have = new Set(existing.map((e) => e.line.targetLabel));
  const merged = [...existing];
  for (const s of seed) {
    if (merged.length >= cap) break;
    if (have.has(s.line.targetLabel)) continue;
    merged.push(s);
  }
  return merged;
}

export function App() {
  const graphRef = useRef<Graph>(createGraph());
  const effectsRef = useRef<Effect[]>([]);
  const versionRef = useRef<number>(0);
  const lastSaveRef = useRef<number>(0);
  const feedSeqRef = useRef<number>(0);
  const entriesRef = useRef<FeedEntry[]>([]);
  const lastLiveEventTsRef = useRef<number>(0);

  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<SourceMode>("mock");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [headline, setHeadline] = useState<{ text: string; meta: string } | null>(null);
  const [totals, setTotals] = useState<Totals>(() => computeTotals(graphRef.current));
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const onHover = useCallback((h: HoverInfo | null) => setHover(h), []);

  useEffect(() => {
    let cancelled = false;
    const { primary, mode, auxiliary } = selectSources();
    setMode(mode);

    // Only persist/restore real chain data, scoped so mock never pollutes live.
    const cacheScope = mode === "live" ? "live" : null;

    const pushEntries = (next: FeedEntry[]) => {
      entriesRef.current = next;
      setEntries(next);
    };

    if (cacheScope) {
      const cached = loadGraph(cacheScope);
      if (cached) {
        graphRef.current = cached;
        versionRef.current += 1; // paint cache instantly
        setTotals(computeTotals(cached));
      }
      const cachedFeed = loadFeed(cacheScope);
      if (cachedFeed?.length) pushEntries(cachedFeed.slice(0, FEED_SIZE));
    }

    const maybeSave = () => {
      if (!cacheScope) return;
      const now = Date.now();
      if (now - lastSaveRef.current > CACHE_THROTTLE_MS) {
        lastSaveRef.current = now;
        saveGraph(graphRef.current, cacheScope);
        saveFeed(entriesRef.current, cacheScope);
      }
    };

    (async () => {
      if (!primary.loadSnapshot) {
        setLive(true);
        return;
      }
      const snap = await primary.loadSnapshot((p) => !cancelled && setProgress(p));
      if (cancelled) return;
      applySnapshot(graphRef.current, snap);
      versionRef.current += 1;
      setTotals(computeTotals(graphRef.current));
      setProgress(null);
      setLive(true);
      // Fill the feed from the newest apps so it isn't empty on a quiet chain.
      pushEntries(mergeFeed(entriesRef.current, seedFeed(snap, graphRef.current, FEED_SIZE), FEED_SIZE));
      if (cacheScope) {
        saveGraph(graphRef.current, cacheScope);
        saveFeed(entriesRef.current, cacheScope);
      }
    })();

    const handlers: ConstellationHandlers = {
      onEvent: ({ event, ts }) => {
        if (cancelled) return;
        applyEvent(graphRef.current, event, ts);
        pruneGraph(graphRef.current, MAX_NODES);
        versionRef.current += 1;
        for (const fx of effectsForEvent(event, ts)) effectsRef.current.push(fx);

        const line = describeEvent(event, graphRef.current);
        const entry: FeedEntry = { id: `${feedSeqRef.current++}`, time: timeOf(ts), line };
        pushEntries([entry, ...entriesRef.current].slice(0, FEED_SIZE));
        setHeadline({
          text: headlineFor(event, graphRef.current),
          meta: line.xp != null ? `+${line.xp} XP` : "",
        });
        setTotals(computeTotals(graphRef.current));
        lastLiveEventTsRef.current = ts;
        maybeSave();
      },
      onRelabel: ({ address, username, ts }: RelabelEvent) => {
        if (cancelled) return;
        const changed = relabelBuilder(graphRef.current, address, username);
        if (!changed) return;
        versionRef.current += 1;
        // A pulse keeps the change visible at-a-glance on a busy canvas.
        effectsRef.current.push({ type: "pulse", nodeId: address.toLowerCase(), start: ts });
        maybeSave();
      },
      onHighlight: (h: Highlight) => {
        if (cancelled) return;
        const entry: FeedEntry = {
          id: `hl:${h.id}`,
          time: timeOf(h.ts),
          line: highlightToLine(h),
        };
        // Don't duplicate: highlights are deduped by source-side `seen`, but
        // a re-render across remounts can still pass the same id — guard.
        if (!entriesRef.current.some((e) => e.id === entry.id)) {
          pushEntries([entry, ...entriesRef.current].slice(0, FEED_SIZE));
        }
        // Pulse the related node if one exists in the current graph.
        if (h.nodeId && graphRef.current.nodes.has(h.nodeId.toLowerCase())) {
          effectsRef.current.push({
            type: "pulse",
            nodeId: h.nodeId.toLowerCase(),
            start: h.ts,
          });
        } else if (h.nodeId && graphRef.current.nodes.has(h.nodeId)) {
          effectsRef.current.push({ type: "pulse", nodeId: h.nodeId, start: h.ts });
        }
        // Only take over the big headline if the chain has been quiet —
        // otherwise leave the live event's headline showing.
        if (h.headline && h.ts - lastLiveEventTsRef.current > HEADLINE_QUIET_MS) {
          setHeadline({ text: h.headline, meta: "" });
        }
      },
    };

    const unsubs: Array<() => void> = [primary.subscribe(handlers)];
    for (const aux of auxiliary) unsubs.push(aux.subscribe(handlers));

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, []);

  return (
    <div className="app">
      <TopStrip totals={totals} live={live} />
      <div className="stage">
        <div className="canvas-wrap">
          <ConstellationCanvas
            graphRef={graphRef}
            effectsRef={effectsRef}
            versionRef={versionRef}
            onHover={onHover}
          />
          <Headline text={headline?.text ?? null} meta={headline?.meta} />
          <LoadingProgress progress={progress} />
          <div className="corner-tl">
            {mode === "mock" && <div className="mock-badge">MOCK DATA</div>}
            <Legend />
          </div>
          <div className="controls-hint">scroll zoom · drag pan · R reset</div>
          <NodeTooltip hover={hover} />
        </div>
        <aside className="feed-pane">
          <EventFeed entries={entries} />
        </aside>
      </div>
    </div>
  );
}
