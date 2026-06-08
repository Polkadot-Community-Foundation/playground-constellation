// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useCallback, useEffect, useRef, useState } from "react";
import { saveGraph, loadGraph, saveFeed, loadFeed } from "./chain/cache.ts";
import { selectSources, type SourceMode } from "./chain/select.ts";
import type {
  ConstellationHandlers,
  Highlight,
  LoadProgress,
  RelabelEvent,
} from "./chain/source.ts";
import { cometBetween, cometToward, effectsForEvent, type Effect } from "./graph/effects.ts";
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
  type GraphSnapshot,
  type Totals,
} from "./model/graph.ts";
import {
  describeEvent,
  headlineFor,
  labelFor,
  seedFeed,
  type FeedEntry,
  type FeedLine,
} from "./model/format.ts";
import { filterGraph, isExcludedDomain } from "./chain/filter.ts";
import { laneForHighlightId, type TickerItem } from "./model/ticker.ts";
import { EventFeed } from "./ui/EventFeed.tsx";
import { Ticker } from "./ui/Ticker.tsx";
import { LoadingProgress } from "./ui/LoadingProgress.tsx";
import { TopStrip } from "./ui/TopStrip.tsx";

// Keep a generous buffer; the feed column flexes and clips the oldest, so
// larger screens show more without leaving empty space at the bottom.
const FEED_SIZE = 24;
const CACHE_THROTTLE_MS = 3000;
// Ticker pool: how many recent items the idle rotation draws from.
const TICKER_POOL_LIMIT = 48;
// Ambient gold comets fire on this jittered cadence — but only when the chain
// has been quiet for AMBIENT_QUIET_MS, so they never compete with real bursts.
const AMBIENT_MIN_MS = 5000;
const AMBIENT_MAX_MS = 8000;
const AMBIENT_QUIET_MS = 4000;

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

/**
 * Build initial highlight ticker items straight from the cold-load snapshot,
 * so the strip has content the instant the graph paints (before the 60s
 * highlights poll lands). The ids match chain/highlights.ts (`hl:` + the
 * highlight id), so the live poll dedups against these rather than repeating.
 */
function seedTicker(snap: GraphSnapshot, graph: Graph): TickerItem[] {
  const out: TickerItem[] = [];
  const leader = snap.builders[0];
  if (leader && leader.xp > 0) {
    out.push({
      id: `hl:leader:${leader.address}:${leader.xp}`,
      text: `${labelFor(graph, leader.address)} leads the leaderboard with ${leader.xp} XP`,
      tone: "highlight",
      lane: "highlight",
    });
  }
  // Match chain/highlights.ts RECENT_APPS_LIMIT so the seed and the 60s poll
  // surface the same recent-publish set (the poll then dedups against these).
  for (const a of snap.apps.slice(0, 5)) {
    out.push({
      id: `hl:recent:${a.domain}:${a.owner}`,
      text: `${labelFor(graph, a.owner)} published ${a.domain}`,
      tone: "highlight",
      lane: "recent-publish",
    });
  }
  if (snap.apps.length > 0) {
    out.push({
      id: `hl:app-count:${snap.apps.length}`,
      text: `${snap.apps.length} apps published`,
      tone: "highlight",
      lane: "highlight",
    });
  }
  return out;
}

export function App() {
  const graphRef = useRef<Graph>(createGraph());
  const effectsRef = useRef<Effect[]>([]);
  const versionRef = useRef<number>(0);
  const lastSaveRef = useRef<number>(0);
  const feedSeqRef = useRef<number>(0);
  const tickerSeqRef = useRef<number>(0);
  const entriesRef = useRef<FeedEntry[]>([]);
  const tickerRef = useRef<TickerItem[]>([]);
  const lastLiveEventTsRef = useRef<number>(0);

  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<SourceMode>("mock");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [ticker, setTicker] = useState<TickerItem[]>([]);
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

    /** Append ticker items (dedup by id, cap to the pool limit). */
    const pushTicker = (items: TickerItem[]) => {
      if (items.length === 0) return;
      const have = new Set(tickerRef.current.map((i) => i.id));
      const fresh = items.filter((i) => !have.has(i.id));
      if (fresh.length === 0) return;
      const next = [...tickerRef.current, ...fresh].slice(-TICKER_POOL_LIMIT);
      tickerRef.current = next;
      setTicker(next);
    };

    const nodeIds = (): string[] => [...graphRef.current.nodes.keys()];

    /** Resolve a highlight's nodeId to the key actually present in the graph. */
    const resolveNode = (nodeId: string | undefined): string | null => {
      if (!nodeId) return null;
      if (graphRef.current.nodes.has(nodeId)) return nodeId;
      const lower = nodeId.toLowerCase();
      return graphRef.current.nodes.has(lower) ? lower : null;
    };

    if (cacheScope) {
      const cached = loadGraph(cacheScope);
      if (cached) {
        // Scrub any excluded nodes a pre-filter cache may still hold, so e2e
        // apps can't flash on the instant-paint before the snapshot lands.
        filterGraph(cached);
        graphRef.current = cached;
        versionRef.current += 1; // paint cache instantly
        setTotals(computeTotals(cached));
      }
      const cachedFeed = loadFeed(cacheScope);
      if (cachedFeed?.length) {
        // Drop any excluded-domain rows a pre-filter cache may still hold (the
        // target label is the app domain for app-targeted events).
        const clean = cachedFeed.filter((e) => !isExcludedDomain(e.line.targetLabel));
        if (clean.length) pushEntries(clean.slice(0, FEED_SIZE));
      }
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
      // Fill the feed + ticker from the snapshot so neither is empty on a quiet chain.
      pushEntries(mergeFeed(entriesRef.current, seedFeed(snap, graphRef.current, FEED_SIZE), FEED_SIZE));
      pushTicker(seedTicker(snap, graphRef.current));
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
        // Live events scroll through the ticker with priority.
        const xp = line.xp != null ? ` · +${line.xp} XP` : "";
        pushTicker([
          {
            id: `live:${tickerSeqRef.current++}`,
            text: `${headlineFor(event, graphRef.current)}${xp}`,
            tone: "live",
            lane: "live",
          },
        ]);
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
        // The same phrase scrolls in the ticker (its idle-rotation lane).
        pushTicker([
          {
            id: `hl:${h.id}`,
            text: h.headline ?? h.feedLabel,
            tone: "highlight",
            lane: laneForHighlightId(h.id),
          },
        ]);
        // Fire a gold comet so the canvas stays alive even when nothing is
        // happening: toward the highlight's node if it exists, otherwise
        // between two random nodes. Pulse the node too when present.
        // Effects render every frame from effectsRef, so no versionRef bump is
        // needed here — a highlight doesn't mutate the graph (that bump only
        // re-syncs the force layout, which the snapshot/onEvent paths handle).
        const node = resolveNode(h.nodeId);
        const ids = nodeIds();
        const fx = node
          ? cometToward(node, ids, "highlightStar", h.ts)
          : cometBetween(ids, "highlightStar", h.ts);
        if (fx) effectsRef.current.push(fx);
        if (node) effectsRef.current.push({ type: "pulse", nodeId: node, start: h.ts });
      },
    };

    const unsubs: Array<() => void> = [primary.subscribe(handlers)];
    for (const aux of auxiliary) unsubs.push(aux.subscribe(handlers));

    // Ambient gold comets: a slow heartbeat that keeps the sky drifting during
    // quiet stretches. Skipped while live events are flowing (last < 4s ago).
    let ambientTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleAmbient = () => {
      const delay = AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS);
      ambientTimer = setTimeout(() => {
        if (cancelled) return;
        const now = Date.now();
        if (now - lastLiveEventTsRef.current > AMBIENT_QUIET_MS) {
          const fx = cometBetween(nodeIds(), "ambientStar", now);
          if (fx) effectsRef.current.push(fx);
        }
        scheduleAmbient();
      }, delay);
    };
    scheduleAmbient();

    return () => {
      cancelled = true;
      if (ambientTimer !== null) clearTimeout(ambientTimer);
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
          <Ticker pool={ticker} />
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
