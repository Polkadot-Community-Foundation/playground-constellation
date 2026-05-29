import { XP_BASE, XP_MULTIPLIER } from "../config.ts";
import type { LogicalEvent, LogicalKind } from "../chain/types.ts";
import { shortAddr, type Graph, type GraphSnapshot } from "./graph.ts";

/** Resolve an id (app domain or builder address) to a display label. */
export function labelFor(graph: Graph, id: string): string {
  const direct = graph.nodes.get(id);
  if (direct) return direct.label;
  const lower = graph.nodes.get(id.toLowerCase());
  if (lower) return lower.label;
  if (id.startsWith("0x")) return shortAddr(id.toLowerCase());
  return id;
}

export interface FeedLine {
  tag: string;
  actorLabel: string;
  symbol: string;
  targetLabel: string;
  xp?: number;
}

export interface FeedEntry {
  id: string;
  /** HH:MM:SS for live events; empty for snapshot-seeded entries. */
  time: string;
  line: FeedLine;
}

/**
 * Contract-actual XP for the event, times the display multiplier (config.ts).
 * Deploy is 2, or 3 when moddable. Mod credit and star are each 1. Other
 * kinds carry no XP label.
 */
function xpFor(e: LogicalEvent): number | undefined {
  switch (e.kind) {
    case "deploy":
      return (XP_BASE.deploy + (e.moddable ? XP_BASE.moddableBonus : 0)) * XP_MULTIPLIER.deploy;
    case "mod":
      return XP_BASE.mod * XP_MULTIPLIER.mod;
    case "star":
      return XP_BASE.star * XP_MULTIPLIER.star;
    default:
      return undefined;
  }
}

interface KindStyle {
  tag: string;
  symbol: string;
  verb: string;
  /** "app" → target is the affected app; "source" → target is the mod source. */
  target: "app" | "source";
}

const STYLE: Record<LogicalKind, KindStyle> = {
  deploy: { tag: "DEPLOY", symbol: "→", verb: "deployed", target: "app" },
  mod: { tag: "MOD", symbol: "⇢", verb: "modded", target: "source" },
  star: { tag: "STAR", symbol: "★", verb: "starred", target: "app" },
  unstar: { tag: "UNSTAR", symbol: "✩", verb: "unstarred", target: "app" },
  pin: { tag: "PIN", symbol: "◆", verb: "pinned", target: "app" },
  unpin: { tag: "UNPIN", symbol: "◇", verb: "unpinned", target: "app" },
  publish: { tag: "UPDATE", symbol: "↻", verb: "updated", target: "app" },
  unpublish: { tag: "REMOVE", symbol: "✕", verb: "removed", target: "app" },
  rate: { tag: "RATE", symbol: "✎", verb: "rated", target: "app" },
  unrate: { tag: "UNRATE", symbol: "✎", verb: "removed a rating on", target: "app" },
  visibility: { tag: "VISIBILITY", symbol: "◐", verb: "changed visibility of", target: "app" },
};

function targetId(e: LogicalEvent, style: KindStyle): string {
  return style.target === "source" && e.source ? e.source : e.app;
}

export function describeEvent(e: LogicalEvent, graph: Graph): FeedLine {
  const style = STYLE[e.kind];
  return {
    tag: style.tag,
    actorLabel: e.actor ? labelFor(graph, e.actor) : "someone",
    symbol: style.symbol,
    targetLabel: labelFor(graph, targetId(e, style)),
    xp: xpFor(e),
  };
}

export function headlineFor(e: LogicalEvent, graph: Graph): string {
  const style = STYLE[e.kind];
  const actor = e.actor ? labelFor(graph, e.actor) : "someone";
  return `${actor} just ${style.verb} ${labelFor(graph, targetId(e, style))}`;
}

/**
 * Build feed entries from the most-recently deployed apps in a cold-load
 * snapshot (newest-first), so the feed isn't empty when the chain is quiet.
 * These have no timestamp (we don't know when they were deployed).
 */
export function seedFeed(snap: GraphSnapshot, graph: Graph, count: number): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const a of snap.apps) {
    if (out.length >= count) break;
    if (a.pinned) continue;
    const line = describeEvent({ kind: "deploy", app: a.domain, actor: a.owner, blockKey: "seed" }, graph);
    out.push({ id: `seed:${a.domain}`, time: "", line });
  }
  return out;
}
