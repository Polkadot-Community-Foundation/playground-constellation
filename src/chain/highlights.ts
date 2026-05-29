// Periodic "highlights" source for the constellation: polls the registry's
// read surface and surfaces summary insights as non-graph-mutating display
// items. Keeps the headline + feed alive during quiet stretches without
// faking events. Empty results (e.g. a freshly-redeployed contract) are
// handled gracefully — the source simply emits nothing.

import { getChainHandle, type ChainMode } from "./client.ts";
import type { RegistryContract } from "./registryContract.ts";
import { shortAddr } from "../model/graph.ts";
import type { ConstellationHandlers, ConstellationSource, Highlight } from "./source.ts";

const REFRESH_EVERY_MS = 60_000;
const TOP_BUILDER_LIMIT = 1;
const RECENT_APPS_LIMIT = 5;

interface Snapshot {
  leader: { address: string; xp: bigint } | null;
  recent: { domain: string; owner: string }[];
  appCount: number | null;
  usernames: Map<string, string | null>;
}

async function readSnapshot(registry: RegistryContract): Promise<Snapshot> {
  const [topRes, appsRes, countRes] = await Promise.all([
    registry.getTopBuilders.query(0, TOP_BUILDER_LIMIT),
    registry.getApps.query(0, RECENT_APPS_LIMIT),
    Promise.resolve(undefined), // app count derived from the apps page total below
  ]);

  const top = topRes.success ? topRes.value[0] : undefined;
  const leader = top
    ? { address: top.account.toLowerCase(), xp: BigInt(top.score) }
    : null;

  const appsPage = appsRes.success ? appsRes.value : undefined;
  const recent = (appsPage?.entries ?? []).map((e) => ({
    domain: e.domain,
    owner: e.owner.toLowerCase(),
  }));
  const appCount = appsPage ? appsPage.total : null;

  // Resolve usernames for the union of leader + recent app owners.
  const addrs: string[] = [];
  if (leader) addrs.push(leader.address);
  for (const r of recent) if (!addrs.includes(r.owner)) addrs.push(r.owner);
  const usernames = new Map<string, string | null>();
  if (addrs.length > 0) {
    const uRes = await registry.getUsernames.query(addrs as `0x${string}`[]);
    if (uRes.success) {
      addrs.forEach((a, i) => {
        const n = uRes.value[i] ?? "";
        usernames.set(a, n === "" ? null : n);
      });
    }
  }

  // Suppress the unused countRes binding above without losing intent.
  void countRes;
  return { leader, recent, appCount, usernames };
}

function displayFor(addr: string, usernames: Map<string, string | null>): string {
  return usernames.get(addr) ?? shortAddr(addr);
}

function buildHighlights(snap: Snapshot, ts: number): Highlight[] {
  const out: Highlight[] = [];

  if (snap.leader && snap.leader.xp > 0n) {
    const name = displayFor(snap.leader.address, snap.usernames);
    const xp = snap.leader.xp.toString();
    out.push({
      id: `leader:${snap.leader.address}:${xp}`,
      feedLabel: `${name} leads · ${xp} XP`,
      headline: `${name} is on top with ${xp} XP`,
      nodeId: snap.leader.address,
      ts,
    });
  }

  // Use the snapshot's most-recent-apps list as background highlights so the
  // feed isn't empty when nothing has happened for a minute. We don't pulse
  // here — the live event for the same domain (when it eventually arrives)
  // will do that. These are purely feed filler.
  for (const r of snap.recent) {
    const owner = displayFor(r.owner, snap.usernames);
    out.push({
      id: `recent:${r.domain}:${r.owner}`,
      feedLabel: `${owner} → ${r.domain}`,
      headline: `${owner} published ${r.domain}`,
      nodeId: r.domain,
      ts,
    });
  }

  if (snap.appCount !== null && snap.appCount > 0) {
    out.push({
      id: `app-count:${snap.appCount}`,
      feedLabel: `${snap.appCount} apps live`,
      headline: `${snap.appCount.toLocaleString()} apps published on Playground`,
      ts,
    });
  }

  return out;
}

/**
 * Auxiliary source that polls `getTopBuilders` + `getApps` + app-count every
 * 60s and emits Highlight items for any new derivable insight. Doesn't load
 * a snapshot — the primary live source handles that.
 */
export function createHighlightsSource(mode: ChainMode): ConstellationSource {
  return {
    subscribe(handlers: ConstellationHandlers): () => void {
      const { onHighlight } = handlers;
      if (!onHighlight) return () => {};

      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const seen = new Set<string>();

      const tick = async (): Promise<void> => {
        if (cancelled) return;
        try {
          const { registry } = await getChainHandle(mode);
          if (cancelled) return;
          const snap = await readSnapshot(registry);
          if (cancelled) return;
          const ts = Date.now();
          for (const item of buildHighlights(snap, ts)) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            onHighlight(item);
          }
        } catch (err) {
          // Quiet — empty / redeployed contracts will surface here too. Don't
          // spam the console; one warn per minute is enough.
          const now = Date.now();
          if (now - lastHighlightWarn > 60_000) {
            lastHighlightWarn = now;
            console.warn("[constellation] highlights refresh failed", err);
          }
        }
        if (!cancelled) timer = setTimeout(tick, REFRESH_EVERY_MS);
      };

      // Kick off the first poll without blocking — empty results are fine.
      void tick();

      return () => {
        cancelled = true;
        if (timer !== null) clearTimeout(timer);
      };
    },
  };
}

let lastHighlightWarn = 0;

export { buildHighlights };
