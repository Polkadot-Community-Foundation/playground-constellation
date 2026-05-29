import type { LogicalEvent } from "../chain/types.ts";

export type NodeKind = "app" | "builder";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  pinned: boolean;
  xp: number;
  stars: number;
  mods: number;
  size: number;
  lastActive: number;
  ghost: boolean;
}

export type EdgeKind = "ownership" | "lineage";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

export interface GraphSnapshot {
  apps: { domain: string; owner: string; stars: number; mods: number; pinned: boolean }[];
  builders: { address: string; xp: number; username?: string | null }[];
  lineage: { child: string; source: string }[];
  usernames: Record<string, string | null>;
}

// Smaller bases so nodes read as luminous stars on a wide canvas instead of
// dominating the view. Pinned multiplier kept moderate; the diffraction
// spikes drawn around bright nodes carry the emphasis instead of raw radius.
const APP_BASE = 9;
const BUILDER_BASE = 7;
const PINNED_FACTOR = 1.45;

export function appSize(stars: number, mods: number, pinned: boolean): number {
  const s = APP_BASE + 2.2 * Math.sqrt(stars + 2 * mods);
  return pinned ? s * PINNED_FACTOR : s;
}

export function builderSize(xp: number): number {
  return BUILDER_BASE + 1.7 * Math.sqrt(Math.max(0, xp));
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function createGraph(): Graph {
  return { nodes: new Map(), edges: new Map() };
}

export interface Totals {
  apps: number;
  stars: number;
  xp: number;
}

/**
 * Bound the graph for a long-running kiosk. Evicts the oldest (least recently
 * active) non-pinned APP nodes until at most `maxNodes` remain, drops their
 * edges, then removes any builders left with no edges. Builders connected to a
 * surviving app are always kept, so owners stay visible; pinned roots are never
 * evicted.
 */
export function pruneGraph(g: Graph, maxNodes: number): void {
  if (g.nodes.size <= maxNodes) return;
  const removed = new Set<string>();

  // 1) Evict oldest non-pinned apps until under the cap.
  const apps = [...g.nodes.values()]
    .filter((n) => n.kind === "app" && !n.pinned)
    .sort((a, b) => a.lastActive - b.lastActive);
  for (const n of apps) {
    if (g.nodes.size - removed.size <= maxNodes) break;
    removed.add(n.id);
  }
  if (removed.size === 0) return;
  for (const id of removed) g.nodes.delete(id);
  for (const [id, e] of g.edges) {
    if (removed.has(e.from) || removed.has(e.to)) g.edges.delete(id);
  }

  // 2) Drop builders orphaned by the removals (bounds builder growth).
  const connected = new Set<string>();
  for (const e of g.edges.values()) {
    connected.add(e.from);
    connected.add(e.to);
  }
  for (const n of [...g.nodes.values()]) {
    if (n.kind === "builder" && !connected.has(n.id)) g.nodes.delete(n.id);
  }
}

export function computeTotals(g: Graph): Totals {
  let apps = 0;
  let stars = 0;
  let xp = 0;
  for (const n of g.nodes.values()) {
    if (n.kind === "app") {
      if (!n.ghost) apps += 1;
      stars += n.stars;
    } else {
      xp += n.xp;
    }
  }
  return { apps, stars, xp };
}

function ensureBuilder(g: Graph, address: string, xp?: number, username?: string | null): GraphNode {
  const id = address.toLowerCase();
  let node = g.nodes.get(id);
  if (!node) {
    node = {
      id,
      kind: "builder",
      label: username || shortAddr(id),
      pinned: false,
      xp: xp ?? 0,
      stars: 0,
      mods: 0,
      size: builderSize(xp ?? 0),
      lastActive: 0,
      ghost: false,
    };
    g.nodes.set(id, node);
    return node;
  }
  if (xp !== undefined) {
    node.xp = xp;
    node.size = builderSize(xp);
  }
  if (username) node.label = username;
  return node;
}

function ensureApp(
  g: Graph,
  domain: string,
  init?: { stars?: number; mods?: number; pinned?: boolean },
): GraphNode {
  let node = g.nodes.get(domain);
  if (!node) {
    const stars = init?.stars ?? 0;
    const mods = init?.mods ?? 0;
    const pinned = init?.pinned ?? false;
    node = {
      id: domain,
      kind: "app",
      label: domain,
      pinned,
      xp: 0,
      stars,
      mods,
      size: appSize(stars, mods, pinned),
      lastActive: 0,
      ghost: false,
    };
    g.nodes.set(domain, node);
  } else if (init) {
    if (init.stars !== undefined) node.stars = init.stars;
    if (init.mods !== undefined) node.mods = init.mods;
    if (init.pinned !== undefined) node.pinned = init.pinned;
    node.size = appSize(node.stars, node.mods, node.pinned);
  }
  return node;
}

function addEdge(g: Graph, kind: EdgeKind, from: string, to: string): void {
  const id = `${kind}:${from}->${to}`;
  if (!g.edges.has(id)) g.edges.set(id, { id, from, to, kind });
}

export function applySnapshot(g: Graph, snap: GraphSnapshot): void {
  for (const b of snap.builders) ensureBuilder(g, b.address, b.xp, b.username);
  for (const a of snap.apps) {
    ensureApp(g, a.domain, { stars: a.stars, mods: a.mods, pinned: a.pinned });
    const ownerLabel = snap.usernames[a.owner.toLowerCase()];
    ensureBuilder(g, a.owner, undefined, ownerLabel);
    addEdge(g, "ownership", a.owner.toLowerCase(), a.domain);
  }
  for (const l of snap.lineage) {
    ensureApp(g, l.source);
    ensureApp(g, l.child);
    addEdge(g, "lineage", l.source, l.child);
  }
}

/**
 * Update a builder node's display label in place. `username: null` reverts to
 * the short-address form. No-op if the address has no builder node yet —
 * relabel events arriving before the builder appears are dropped on the floor
 * (the snapshot or a later event will pick up the right name).
 */
export function relabelBuilder(g: Graph, address: string, username: string | null): boolean {
  const id = address.toLowerCase();
  const node = g.nodes.get(id);
  if (!node || node.kind !== "builder") return false;
  const nextLabel = username && username.length > 0 ? username : shortAddr(id);
  if (node.label === nextLabel) return false;
  node.label = nextLabel;
  return true;
}

export function applyEvent(g: Graph, e: LogicalEvent, ts: number): void {
  switch (e.kind) {
    case "deploy": {
      const node = ensureApp(g, e.app);
      node.lastActive = ts;
      node.ghost = false;
      if (e.actor) {
        ensureBuilder(g, e.actor).lastActive = ts;
        addEdge(g, "ownership", e.actor.toLowerCase(), e.app);
      }
      break;
    }
    case "mod": {
      const child = ensureApp(g, e.app);
      child.lastActive = ts;
      child.ghost = false;
      if (e.actor) {
        ensureBuilder(g, e.actor).lastActive = ts;
        addEdge(g, "ownership", e.actor.toLowerCase(), e.app);
      }
      if (e.source) {
        const source = ensureApp(g, e.source);
        source.mods += 1;
        source.size = appSize(source.stars, source.mods, source.pinned);
        source.lastActive = ts;
        addEdge(g, "lineage", e.source, e.app);
      }
      break;
    }
    case "star": {
      const node = ensureApp(g, e.app);
      node.stars += 1;
      node.size = appSize(node.stars, node.mods, node.pinned);
      node.lastActive = ts;
      break;
    }
    case "unstar": {
      const node = ensureApp(g, e.app);
      node.stars = Math.max(0, node.stars - 1);
      node.size = appSize(node.stars, node.mods, node.pinned);
      node.lastActive = ts;
      break;
    }
    case "pin": {
      const node = ensureApp(g, e.app);
      node.pinned = true;
      node.size = appSize(node.stars, node.mods, node.pinned);
      node.lastActive = ts;
      break;
    }
    case "unpin": {
      const node = ensureApp(g, e.app);
      node.pinned = false;
      node.size = appSize(node.stars, node.mods, node.pinned);
      node.lastActive = ts;
      break;
    }
    case "unpublish": {
      const node = ensureApp(g, e.app);
      node.ghost = true;
      node.lastActive = ts;
      break;
    }
    case "publish":
    case "rate":
    case "unrate":
    case "visibility": {
      const node = ensureApp(g, e.app);
      node.lastActive = ts;
      break;
    }
  }
}
