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

// Exclusion filter for keeping e2e-test fixtures (and flagged test accounts)
// off the live kiosk. Applied as a decorator at the source-selection boundary
// (see select.ts) so excluded apps never enter the graph, the event feed, the
// ticker, or the totals — plus a `filterGraph` for scrubbing a stale cache on
// load. The exclusion lists come from config.ts.

import { EXCLUDE_ACCOUNTS, EXCLUDE_DOMAIN_PREFIXES } from "../config.ts";
import type { Graph, GraphSnapshot } from "../model/graph.ts";
import type { ConstellationHandlers, ConstellationSource } from "./source.ts";

// --- Pure predicates (take their lists, so they're trivially testable) -------

export function domainExcludedBy(domain: string | undefined, prefixes: readonly string[]): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return prefixes.some((p) => d.startsWith(p));
}

export function accountExcludedBy(address: string | undefined, accounts: ReadonlySet<string>): boolean {
  if (!address) return false;
  return accounts.has(address.toLowerCase());
}

// --- Configured instances ----------------------------------------------------

const PREFIXES: readonly string[] = EXCLUDE_DOMAIN_PREFIXES.map((p) => p.toLowerCase());
// Dev-signer accounts are NOT hidden (they're colored instead — see config.ts
// isDevAccount); only explicitly-configured accounts are excluded.
const ACCOUNTS: ReadonlySet<string> = new Set(EXCLUDE_ACCOUNTS.map((a) => a.toLowerCase()));

/** True if `domain` starts with a configured excluded prefix (e.g. "e2e"). */
export function isExcludedDomain(domain: string | undefined): boolean {
  return domainExcludedBy(domain, PREFIXES);
}

/** True if `address` is in the configured account denylist. */
export function isExcludedAccount(address: string | undefined): boolean {
  return accountExcludedBy(address, ACCOUNTS);
}

/** Nothing to filter — lets callers skip the decorator entirely. */
export function exclusionsActive(): boolean {
  return PREFIXES.length > 0 || ACCOUNTS.size > 0;
}

// --- Filters -----------------------------------------------------------------

function filterSnapshot(snap: GraphSnapshot): GraphSnapshot {
  return {
    apps: snap.apps.filter((a) => !isExcludedDomain(a.domain) && !isExcludedAccount(a.owner)),
    builders: snap.builders.filter((b) => !isExcludedAccount(b.address)),
    lineage: snap.lineage.filter((l) => !isExcludedDomain(l.child) && !isExcludedDomain(l.source)),
    // usernames is a lookup table; leftover entries for excluded owners are
    // never read once their apps/builders are gone, so we leave it untouched.
    usernames: snap.usernames,
  };
}

/**
 * Remove excluded nodes (and their dangling edges) from a graph in place —
 * used to scrub a cache that was written before the filter existed, so it
 * can't flash e2e nodes on first paint.
 */
export function filterGraph(g: Graph): void {
  const removed = new Set<string>();
  for (const n of g.nodes.values()) {
    const excluded = n.kind === "app" ? isExcludedDomain(n.id) : isExcludedAccount(n.id);
    if (excluded) removed.add(n.id);
  }
  if (removed.size === 0) return;
  for (const id of removed) g.nodes.delete(id);
  for (const [id, e] of g.edges) {
    if (removed.has(e.from) || removed.has(e.to)) g.edges.delete(id);
  }
}

/**
 * Wrap a source so excluded apps/accounts never reach the consumer: the
 * snapshot is filtered, and live events / relabels / highlights touching an
 * excluded domain or account are dropped. A no-op (returns the source as-is)
 * when nothing is configured. Optional handlers stay optional.
 */
export function withExcludedDomains(source: ConstellationSource): ConstellationSource {
  if (!exclusionsActive()) return source;

  const wrapped: ConstellationSource = {
    subscribe(handlers: ConstellationHandlers): () => void {
      const { onEvent, onRelabel, onHighlight } = handlers;
      const filtered: ConstellationHandlers = {
        onEvent:
          onEvent &&
          ((e) => {
            const ev = e.event;
            if (isExcludedDomain(ev.app) || isExcludedDomain(ev.source) || isExcludedAccount(ev.actor)) {
              return;
            }
            onEvent(e);
          }),
        onRelabel:
          onRelabel &&
          ((r) => {
            if (isExcludedAccount(r.address)) return;
            onRelabel(r);
          }),
        onHighlight:
          onHighlight &&
          ((h) => {
            // `nodeId` is a domain (recent-publish) or an address (leader);
            // either form is checked. Node-less highlights (app count) pass.
            if (isExcludedDomain(h.nodeId) || isExcludedAccount(h.nodeId)) return;
            onHighlight(h);
          }),
      };
      return source.subscribe(filtered);
    },
  };

  if (source.loadSnapshot) {
    const inner = source.loadSnapshot.bind(source);
    wrapped.loadSnapshot = async (onProgress) => filterSnapshot(await inner(onProgress));
  }

  return wrapped;
}
