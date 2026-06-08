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

import { describe, expect, it, vi } from "vitest";
import { DEV_SIGNER_ACCOUNTS, isDevAccount } from "../config.ts";
import { applySnapshot, createGraph, type GraphSnapshot } from "../model/graph.ts";
import {
  accountExcludedBy,
  domainExcludedBy,
  filterGraph,
  isExcludedAccount,
  isExcludedDomain,
  withExcludedDomains,
} from "./filter.ts";
import type { ConstellationHandlers, ConstellationSource } from "./source.ts";

describe("domainExcludedBy", () => {
  it("matches a configured prefix, case-insensitively", () => {
    expect(domainExcludedBy("e2e-foo.dot", ["e2e"])).toBe(true);
    expect(domainExcludedBy("E2E-Foo.DOT", ["e2e"])).toBe(true);
    expect(domainExcludedBy("e2eology.dot", ["e2e"])).toBe(true); // prefix, not word
  });
  it("leaves real domains and empty/undefined alone", () => {
    expect(domainExcludedBy("the-ballot.dot", ["e2e"])).toBe(false);
    expect(domainExcludedBy(undefined, ["e2e"])).toBe(false);
    expect(domainExcludedBy("", ["e2e"])).toBe(false);
  });
  it("supports multiple prefixes", () => {
    expect(domainExcludedBy("test-x.dot", ["e2e", "test"])).toBe(true);
  });
});

describe("accountExcludedBy", () => {
  it("matches denylisted addresses case-insensitively", () => {
    const set = new Set(["0xabc"]);
    expect(accountExcludedBy("0xABC", set)).toBe(true);
    expect(accountExcludedBy("0xdef", set)).toBe(false);
    expect(accountExcludedBy(undefined, set)).toBe(false);
  });
});

describe("isExcludedDomain (default config: ['e2e'])", () => {
  it("excludes e2e domains and keeps real ones", () => {
    expect(isExcludedDomain("e2e-app-1.dot")).toBe(true);
    expect(isExcludedDomain("arcade.dot")).toBe(false);
  });
});

describe("dev accounts are colored, not hidden", () => {
  it("flags dev accounts via isDevAccount (case-insensitive) but does NOT exclude them", () => {
    const dev = DEV_SIGNER_ACCOUNTS[0]!;
    expect(isDevAccount(dev)).toBe(true);
    expect(isDevAccount(dev.toUpperCase())).toBe(true);
    expect(isDevAccount("0xdeadbeef")).toBe(false);
    // Crucially: a dev account is not filtered out (no default EXCLUDE_ACCOUNTS).
    expect(isExcludedAccount(dev)).toBe(false);
  });
});

function snapshot(): GraphSnapshot {
  return {
    apps: [
      { domain: "arcade.dot", owner: "0x01", stars: 3, mods: 1, pinned: false },
      { domain: "e2e-foo.dot", owner: "0x02", stars: 0, mods: 0, pinned: false },
    ],
    builders: [
      { address: "0x01", xp: 10, username: "alice" },
      { address: "0x02", xp: 2, username: null },
    ],
    lineage: [{ child: "e2e-foo.dot", source: "arcade.dot" }],
    usernames: { "0x01": "alice", "0x02": null },
  };
}

describe("filterGraph (cache scrub)", () => {
  it("removes excluded app nodes and their dangling edges, keeps real ones", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    expect(g.nodes.has("e2e-foo.dot")).toBe(true); // present before scrub
    filterGraph(g);
    expect(g.nodes.has("e2e-foo.dot")).toBe(false);
    expect(g.nodes.has("arcade.dot")).toBe(true);
    // No surviving edge may reference the removed node.
    for (const e of g.edges.values()) {
      expect(e.from).not.toBe("e2e-foo.dot");
      expect(e.to).not.toBe("e2e-foo.dot");
    }
  });
});

describe("withExcludedDomains (source decorator)", () => {
  it("filters excluded apps and lineage out of the snapshot", async () => {
    const source: ConstellationSource = {
      loadSnapshot: async () => snapshot(),
      subscribe: () => () => {},
    };
    const wrapped = withExcludedDomains(source);
    const snap = await wrapped.loadSnapshot!();
    expect(snap.apps.map((a) => a.domain)).toEqual(["arcade.dot"]);
    expect(snap.lineage).toEqual([]); // child was e2e
  });

  it("drops live events and highlights that touch an excluded domain", () => {
    let captured: ConstellationHandlers | null = null;
    const source: ConstellationSource = {
      subscribe: (h) => {
        captured = h;
        return () => {};
      },
    };
    const onEvent = vi.fn();
    const onHighlight = vi.fn();
    withExcludedDomains(source).subscribe({ onEvent, onHighlight });

    // Real event passes; e2e event and e2e mod-source are dropped.
    captured!.onEvent!({ event: { kind: "star", app: "arcade.dot", blockKey: "1" }, ts: 1 });
    captured!.onEvent!({ event: { kind: "deploy", app: "e2e-foo.dot", blockKey: "2" }, ts: 2 });
    captured!.onEvent!({ event: { kind: "mod", app: "real.dot", source: "e2e-foo.dot", blockKey: "3" }, ts: 3 });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]![0].event.app).toBe("arcade.dot");

    // Highlight on a real domain passes; one on an e2e domain is dropped.
    captured!.onHighlight!({ id: "recent:arcade.dot:0x01", feedLabel: "x", nodeId: "arcade.dot", ts: 4 });
    captured!.onHighlight!({ id: "recent:e2e-foo.dot:0x02", feedLabel: "y", nodeId: "e2e-foo.dot", ts: 5 });
    expect(onHighlight).toHaveBeenCalledTimes(1);
  });
});
