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

import type { GraphSnapshot } from "../model/graph.ts";
import { getChainHandle, type ChainMode } from "./client.ts";
import { resolveNames } from "./names.ts";
import type { AppEntryRaw, QueryResult, RegistryContract } from "./registryContract.ts";
import type { LoadProgress } from "./source.ts";

const APP_PAGE = 50;
const LINEAGE_PAGE = 100;
const TOP_BUILDERS = 100;
const STAT_CONCURRENCY = 20;

function ok<T>(r: QueryResult<T>): T | undefined {
  return r.success ? r.value : undefined;
}

async function pageApps(registry: RegistryContract): Promise<AppEntryRaw[]> {
  const all: AppEntryRaw[] = [];
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const res = await registry.getApps.query(start, APP_PAGE);
    const page = ok(res);
    if (!page) break;
    total = page.total;
    if (page.entries.length === 0) break;
    all.push(...page.entries);
    start += Math.max(page.scanned, page.entries.length);
    if (page.scanned === 0) break;
  }
  return all;
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>, onChunk?: () => void): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
    onChunk?.();
  }
}

async function loadLineage(registry: RegistryContract): Promise<GraphSnapshot["lineage"]> {
  if (!registry.getLineage || !registry.getLineageCount) {
    // Contract change not yet deployed / ABI not refreshed — live-only lineage.
    console.warn("[constellation] get_lineage not in ABI; cold-load lineage skipped");
    return [];
  }
  try {
    const countRes = await registry.getLineageCount.query();
    const total = Number(ok(countRes) ?? 0);
    const out: GraphSnapshot["lineage"] = [];
    for (let start = 0; start < total; start += LINEAGE_PAGE) {
      const res = await registry.getLineage.query(start, LINEAGE_PAGE);
      const page = ok(res);
      if (!page || page.length === 0) break;
      for (const e of page) out.push({ child: e.child, source: e.source });
    }
    return out;
  } catch (err) {
    console.warn("[constellation] get_lineage read failed; live-only lineage", err);
    return [];
  }
}

/** Cold-load the full graph structure via the registry reads (host or direct). */
export async function loadSnapshot(
  mode: ChainMode,
  onProgress?: (p: LoadProgress) => void,
): Promise<GraphSnapshot> {
  const { registry, individuality } = await getChainHandle(mode);

  onProgress?.({ done: 0, total: 1, label: "reading apps" });
  const entries = await pageApps(registry);

  const pinnedRes = await registry.getPinnedApps.query();
  const pinned = new Set((ok(pinnedRes) ?? []).map((e) => e.domain));

  // Per-app star + mod counts.
  const stars = new Map<string, number>();
  const mods = new Map<string, number>();
  let processed = 0;
  await inChunks(
    entries,
    STAT_CONCURRENCY,
    async (e) => {
      const [s, m] = await Promise.all([
        registry.getStarCount.query(e.domain),
        registry.getModCount.query(e.domain),
      ]);
      stars.set(e.domain, Number(ok(s) ?? 0));
      mods.set(e.domain, Number(ok(m) ?? 0));
    },
    () => {
      processed = Math.min(entries.length, processed + STAT_CONCURRENCY);
      onProgress?.({ done: processed, total: entries.length || 1, label: "loading constellation" });
    },
  );

  const apps: GraphSnapshot["apps"] = entries.map((e) => ({
    domain: e.domain,
    owner: e.owner.toLowerCase(),
    stars: stars.get(e.domain) ?? 0,
    mods: mods.get(e.domain) ?? 0,
    pinned: pinned.has(e.domain),
  }));

  // Leaderboard → builder XP.
  const topRes = await registry.getTopBuilders.query(0, TOP_BUILDERS);
  const top = ok(topRes) ?? [];
  const builders = top.map((b) => ({ address: b.account.toLowerCase(), xp: Number(b.score) }));

  // Resolve display names for the union of owners + top builders: each address
  // maps to its DotNS root (getRootAccounts) then to a People-chain username.
  const addrSet = new Set<string>();
  for (const a of apps) addrSet.add(a.owner);
  for (const b of builders) addrSet.add(b.address);
  const usernames = await resolveNames(registry, individuality, [...addrSet]);

  const buildersWithNames = builders.map((b) => ({ ...b, username: usernames[b.address] ?? null }));

  onProgress?.({ done: entries.length || 1, total: entries.length || 1, label: "reading lineage" });
  const lineage = await loadLineage(registry);

  return { apps, builders: buildersWithNames, lineage, usernames };
}