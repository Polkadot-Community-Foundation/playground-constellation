import type { FeedEntry } from "../model/format.ts";
import type { Graph, GraphEdge, GraphNode } from "../model/graph.ts";
import { createGraph } from "../model/graph.ts";

const keyFor = (scope: string) => `constellation.graph.${scope}`;
const feedKeyFor = (scope: string) => `constellation.feed.${scope}`;
const LEGACY_KEY = "constellation.graph.v1";

interface CachePayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  savedAt: number;
}

export function saveGraph(graph: Graph, scope = "default"): void {
  try {
    const payload: CachePayload = {
      nodes: [...graph.nodes.values()],
      edges: [...graph.edges.values()],
      savedAt: Date.now(),
    };
    localStorage.setItem(keyFor(scope), JSON.stringify(payload));
  } catch {
    // Storage full / unavailable — caching is best-effort.
  }
}

export function saveFeed(entries: FeedEntry[], scope = "default"): void {
  try {
    localStorage.setItem(feedKeyFor(scope), JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

export function loadFeed(scope = "default"): FeedEntry[] | null {
  try {
    const raw = localStorage.getItem(feedKeyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedEntry[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function loadGraph(scope = "default"): Graph | null {
  try {
    // One-time cleanup of the pre-scoped key (could hold stale mock data).
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw) return null;
    const payload = JSON.parse(raw) as CachePayload;
    if (!payload?.nodes || !payload?.edges) return null;
    const graph = createGraph();
    for (const n of payload.nodes) graph.nodes.set(n.id, n);
    for (const e of payload.edges) graph.edges.set(e.id, e);
    return graph;
  } catch {
    return null;
  }
}
