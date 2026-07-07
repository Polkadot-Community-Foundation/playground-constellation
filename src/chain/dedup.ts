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

import type { RegistryEvent } from "./events.ts";
import type { LogicalEvent, LogicalKind, NormalizedEvent } from "./types.ts";

const DEPLOY_POINT_EVENTS: ReadonlySet<RegistryEvent> = new Set<RegistryEvent>([
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
]);

// 1:1 mappings for events that stand alone as their own logical action.
const STANDALONE_KIND: Partial<Record<RegistryEvent, LogicalKind>> = {
  StarPointAwarded: "star",
  StarPointRefunded: "unstar",
  Pinned: "pin",
  Unpinned: "unpin",
  Unpublished: "unpublish",
  Rated: "rate",
  RatingRemoved: "unrate",
  VisibilityChanged: "visibility",
};

interface Group {
  blockKey: string;
  app: string;
  minSeq: number;
  events: NormalizedEvent[];
}

function blockOrder(blockKey: string): number {
  const n = Number(blockKey);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/**
 * Identity key for a (block, app) action — the grouping unit shared by
 * `reduceEvents` (collapse within a delivery) and `createBlockDeduper` (drop
 * re-delivered blocks). A `:` separator is collision-proof here: `blockKey` is
 * always digits (`String(block.number)`), so the first non-digit unambiguously
 * ends it, leaving the key uniquely decodable even though the legacy-event path
 * can decode `app` from arbitrary raw UTF-8 bytes.
 */
function eventKey(e: { blockKey: string; app: string }): string {
  return `${e.blockKey}:${e.app}`;
}

/**
 * Collapse a list of decoded contract events into one LogicalEvent per
 * (block, app) action. A deploy or mod emits several raw events; this picks
 * the most specific kind (mod > deploy > publish-update) and keeps distinct
 * apps in the same block separate. Output is ordered by block then arrival.
 */
export function reduceEvents(events: NormalizedEvent[]): LogicalEvent[] {
  const groups = new Map<string, Group>();
  for (const e of events) {
    const key = eventKey(e);
    let g = groups.get(key);
    if (!g) {
      g = { blockKey: e.blockKey, app: e.app, minSeq: e.seq, events: [] };
      groups.set(key, g);
    }
    g.events.push(e);
    if (e.seq < g.minSeq) g.minSeq = e.seq;
  }

  const ordered = [...groups.values()].sort((a, b) => {
    const ba = blockOrder(a.blockKey);
    const bb = blockOrder(b.blockKey);
    if (ba !== bb) return ba - bb;
    return a.minSeq - b.minSeq;
  });

  return ordered.map((g) => reduceGroup(g));
}

/**
 * Cross-delivery dedup for the live feed. `Revive.ContractEmitted.watch()`
 * streams finalized blocks, but a host/WS reconnect on a long-running kiosk can
 * re-deliver an already-seen finalized block. `reduceEvents` only collapses raw
 * events *within* a single delivery, so without this the feed shows the same
 * action as two identical rows. A reduced LogicalEvent is uniquely identified by
 * `(blockKey, app)` — exactly `reduceEvents`' grouping key — so we drop any
 * `(block, app)` pair we've already emitted. The seen-set is bounded (FIFO
 * eviction) so a kiosk running for days can't grow it without limit; the window
 * is far larger than any plausible reconnect replay.
 */
export function createBlockDeduper(
  capacity = 4096,
): (events: LogicalEvent[]) => LogicalEvent[] {
  const seen = new Set<string>();
  const order: string[] = [];
  return (events) => {
    const out: LogicalEvent[] = [];
    for (const e of events) {
      const key = eventKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      order.push(key);
      if (order.length > capacity) {
        const evicted = order.shift();
        if (evicted !== undefined) seen.delete(evicted);
      }
      out.push(e);
    }
    return out;
  };
}

function reduceGroup(g: Group): LogicalEvent {
  const find = (name: RegistryEvent) => g.events.find((e) => e.name === name);

  const mod = find("ModPointAwarded");
  if (mod) {
    return { kind: "mod", app: g.app, actor: mod.actor, source: mod.source, blockKey: g.blockKey };
  }

  const deployPoint = g.events.find((e) => DEPLOY_POINT_EVENTS.has(e.name));
  if (deployPoint) {
    const moddable = g.events.some((e) => e.name === "ModdablePointAwarded");
    return { kind: "deploy", app: g.app, actor: deployPoint.actor, moddable, blockKey: g.blockKey };
  }

  // A bare Published with no point event is a re-publish / metadata update.
  if (find("Published")) {
    return { kind: "publish", app: g.app, actor: undefined, blockKey: g.blockKey };
  }

  // Otherwise a single standalone event drives the group.
  const first = g.events[0];
  const kind = STANDALONE_KIND[first.name] ?? "publish";
  return { kind, app: g.app, actor: first.actor, source: first.source, blockKey: g.blockKey };
}
