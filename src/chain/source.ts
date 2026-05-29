import type { GraphSnapshot } from "../model/graph.ts";
import type { LogicalEvent } from "./types.ts";

export interface LoadProgress {
  done: number;
  total: number;
  label: string;
}

/** A live LogicalEvent with its wall-clock receipt time. */
export interface LiveEvent {
  event: LogicalEvent;
  ts: number;
}

/**
 * A live builder relabel — fired when UsernameSet/UsernameCleared on chain
 * changes the display name for an existing builder node. `username: null`
 * means the builder cleared their name and should fall back to short-addr.
 */
export interface RelabelEvent {
  address: string;
  username: string | null;
  ts: number;
}

/**
 * A non-graph-mutating display item — used to keep the headline and feed
 * alive during quiet stretches. `nodeId`, if set, identifies an existing
 * node to pulse when this highlight surfaces.
 */
export interface Highlight {
  /** Stable id used to dedup across polls (e.g. "leader:0xabc:412"). */
  id: string;
  /** Short text for the feed pane. */
  feedLabel: string;
  /** Optional long text for the big headline. Falls back to feedLabel. */
  headline?: string;
  /** Optional graph node to pulse when this highlight is displayed. */
  nodeId?: string;
  ts: number;
}

export interface ConstellationHandlers {
  /** Graph-mutating logical events (deploy, mod, star, etc.). */
  onEvent?: (e: LiveEvent) => void;
  /** Username changes — re-label an existing builder node in place. */
  onRelabel?: (r: RelabelEvent) => void;
  /** Display-only items for headline / feed / node pulse. */
  onHighlight?: (h: Highlight) => void;
}

/**
 * Source of constellation data. The "primary" source provides the cold-load
 * snapshot AND the live event stream; auxiliary sources only emit (e.g. the
 * periodic registry-highlights poll has no snapshot). `loadSnapshot` is
 * therefore optional — auxiliaries omit it.
 */
export interface ConstellationSource {
  loadSnapshot?(onProgress?: (p: LoadProgress) => void): Promise<GraphSnapshot>;
  subscribe(handlers: ConstellationHandlers): () => void;
}
