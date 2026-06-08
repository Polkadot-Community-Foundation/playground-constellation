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

// Pure model for the bottom ticker. A ticker item is one phrase that scrolls
// across the lower third — either a real live event or a polled highlight.
// The replay rotation (ported from playground-app's event-stream pool) cycles
// through lanes so highlights don't all clump: a live lane, a general
// highlight lane (leaderboard, app count), and a recent-publish lane. Live
// items are injected with priority by the component; this module only handles
// the idle rotation and lane bookkeeping.

/** Which rotation lane an item belongs to. Mirrors playground-app's ticker. */
export type TickerLane = "live" | "highlight" | "recent-publish";

export interface TickerItem {
  /** Stable id; live items use a sequence, highlights reuse the highlight id. */
  id: string;
  /** The phrase shown on screen. */
  text: string;
  /** "live" = real on-chain event; "highlight" = polled/derived insight. */
  tone: "live" | "highlight";
  lane: TickerLane;
}

/** Order lanes are visited in. Live first so real events read as primary. */
export const LANE_ORDER: readonly TickerLane[] = ["live", "highlight", "recent-publish"];

/** Classify a highlight by its source id (see chain/highlights.ts ids). */
export function laneForHighlightId(id: string): TickerLane {
  return id.startsWith("recent:") ? "recent-publish" : "highlight";
}

export interface ReplayCursor {
  laneIndex: number;
  itemIndexes: Record<string, number>;
}

export function createReplayCursor(): ReplayCursor {
  return { laneIndex: 0, itemIndexes: {} };
}

export function isHighlight(item: TickerItem): boolean {
  return item.lane !== "live";
}

/**
 * Pick the next item for idle replay: round-robin across the non-empty lanes,
 * advancing a per-lane cursor so each lane cycles its own items independently.
 * Returns null only when there is nothing to show at all.
 */
export function nextReplayItem(items: readonly TickerItem[], cursor: ReplayCursor): TickerItem | null {
  const byLane = new Map<TickerLane, TickerItem[]>();
  for (const item of items) {
    const lane = item.lane;
    byLane.set(lane, [...(byLane.get(lane) ?? []), item]);
  }

  const lanes = LANE_ORDER.map((key) => ({ key, items: byLane.get(key) ?? [] })).filter(
    (lane) => lane.items.length > 0,
  );
  if (lanes.length === 0) return null;

  const lane = lanes[cursor.laneIndex % lanes.length]!;
  cursor.laneIndex += 1;

  const itemIndex = cursor.itemIndexes[lane.key] ?? 0;
  cursor.itemIndexes[lane.key] = itemIndex + 1;
  return lane.items[itemIndex % lane.items.length]!;
}

/** Seed `count` items by walking the replay rotation (used to fill the track). */
export function mixedReplayItems(
  items: readonly TickerItem[],
  count: number,
  cursor: ReplayCursor = createReplayCursor(),
): TickerItem[] {
  const out: TickerItem[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const item = nextReplayItem(items, cursor);
    if (!item) break;
    out.push(item);
  }
  return out;
}

/**
 * Choose the next item to scroll on: a queued live event takes priority (and
 * is removed from the queue), otherwise fall back to the idle replay rotation,
 * skipping anything still queued so it isn't shown twice. Mutates `pending`
 * (shift), `pendingIds` (delete), and `cursor` (advance) — like an iterator.
 * Returns null when there is nothing to show (caller supplies its own
 * last-resort fallback). Extracted from the component so the priority/dedup
 * path is unit-testable.
 */
export function nextTickerItem(
  pending: TickerItem[],
  pendingIds: Set<string>,
  pool: readonly TickerItem[],
  cursor: ReplayCursor,
): TickerItem | null {
  const queued = pending.shift();
  if (queued) {
    pendingIds.delete(queued.id);
    return queued;
  }
  for (let i = 0; i < Math.max(pool.length, 1); i++) {
    const item = nextReplayItem(pool, cursor);
    if (!item) break;
    if (!pendingIds.has(item.id)) return item;
  }
  return null;
}
