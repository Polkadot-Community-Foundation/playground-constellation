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

import { describe, expect, it } from "vitest";
import {
  createReplayCursor,
  isHighlight,
  laneForHighlightId,
  mixedReplayItems,
  nextReplayItem,
  nextTickerItem,
  type TickerItem,
} from "./ticker.ts";

function item(id: string, lane: TickerItem["lane"]): TickerItem {
  return { id, text: id, tone: lane === "live" ? "live" : "highlight", lane };
}

describe("laneForHighlightId", () => {
  it("routes recent: ids to the recent-publish lane", () => {
    expect(laneForHighlightId("recent:foo.dot:0xabc")).toBe("recent-publish");
  });
  it("routes leader / app-count ids to the highlight lane", () => {
    expect(laneForHighlightId("leader:0xabc:412")).toBe("highlight");
    expect(laneForHighlightId("app-count:54")).toBe("highlight");
  });
});

describe("isHighlight", () => {
  it("is false for live, true otherwise", () => {
    expect(isHighlight(item("a", "live"))).toBe(false);
    expect(isHighlight(item("b", "highlight"))).toBe(true);
    expect(isHighlight(item("c", "recent-publish"))).toBe(true);
  });
});

describe("nextReplayItem", () => {
  it("returns null for an empty pool", () => {
    expect(nextReplayItem([], createReplayCursor())).toBeNull();
  });

  it("round-robins across lanes in LANE_ORDER, cycling within each lane", () => {
    const pool: TickerItem[] = [
      item("live1", "live"),
      item("live2", "live"),
      item("hl1", "highlight"),
      item("rp1", "recent-publish"),
      item("rp2", "recent-publish"),
    ];
    const cursor = createReplayCursor();
    const seq = Array.from({ length: 6 }, () => nextReplayItem(pool, cursor)!.id);
    // live → highlight → recent-publish, then wrap, advancing each lane's own cursor.
    expect(seq).toEqual(["live1", "hl1", "rp1", "live2", "hl1", "rp2"]);
  });

  it("skips empty lanes (only highlights present)", () => {
    const pool = [item("hl1", "highlight"), item("hl2", "highlight")];
    const cursor = createReplayCursor();
    expect([0, 1, 2].map(() => nextReplayItem(pool, cursor)!.id)).toEqual(["hl1", "hl2", "hl1"]);
  });
});

describe("mixedReplayItems", () => {
  it("fills up to count by walking the rotation", () => {
    const pool = [item("live1", "live"), item("hl1", "highlight")];
    expect(mixedReplayItems(pool, 4).map((i) => i.id)).toEqual(["live1", "hl1", "live1", "hl1"]);
  });
  it("returns empty for an empty pool", () => {
    expect(mixedReplayItems([], 5)).toEqual([]);
  });
});

describe("nextTickerItem", () => {
  it("serves queued live items first, in order, removing them from the queue", () => {
    const pending = [item("live1", "live"), item("live2", "live")];
    const pendingIds = new Set(pending.map((i) => i.id));
    const pool = [item("hl1", "highlight")];
    const cursor = createReplayCursor();

    expect(nextTickerItem(pending, pendingIds, pool, cursor)?.id).toBe("live1");
    expect(nextTickerItem(pending, pendingIds, pool, cursor)?.id).toBe("live2");
    expect(pending).toHaveLength(0);
    expect(pendingIds.size).toBe(0);
    // Queue drained → falls back to the replay rotation.
    expect(nextTickerItem(pending, pendingIds, pool, cursor)?.id).toBe("hl1");
  });

  it("skips replay items still queued as pending so they aren't shown twice", () => {
    // live1 is in the pool AND queued; replay must skip it and pick the highlight.
    const pending = [item("live1", "live")];
    const pendingIds = new Set(["live1"]);
    const pool = [item("live1", "live"), item("hl1", "highlight")];
    const cursor = createReplayCursor();

    // First call drains the pending live item.
    expect(nextTickerItem(pending, pendingIds, pool, cursor)?.id).toBe("live1");
    // Re-queue it to simulate it still being pending while replay runs.
    pendingIds.add("live1");
    expect(nextTickerItem([], pendingIds, pool, cursor)?.id).toBe("hl1");
  });

  it("returns null when nothing is available", () => {
    expect(nextTickerItem([], new Set(), [], createReplayCursor())).toBeNull();
  });
});
