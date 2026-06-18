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
import type { LogicalEvent, NormalizedEvent } from "./types.ts";
import { createBlockDeduper, reduceEvents } from "./dedup.ts";

const A = "0x" + "0a".repeat(20);
const B = "0x" + "0b".repeat(20);

function ev(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "name" | "app">): NormalizedEvent {
  return { blockKey: "100", actor: undefined, source: undefined, seq: 0, ...partial };
}

describe("reduceEvents", () => {
  it("collapses a deploy burst (Published + Deploy/Publish/Moddable point) into one deploy", () => {
    const out = reduceEvents([
      ev({ name: "Published", app: "chess.dot", seq: 0 }),
      ev({ name: "DeployPointAwarded", app: "chess.dot", actor: A, seq: 1 }),
      ev({ name: "PlaygroundPublishPointAwarded", app: "chess.dot", actor: A, seq: 2 }),
      ev({ name: "ModdablePointAwarded", app: "chess.dot", actor: A, seq: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "deploy", app: "chess.dot", actor: A });
  });

  it("collapses a mod burst into one mod, preferring ModPointAwarded over the deploy", () => {
    const out = reduceEvents([
      ev({ name: "Published", app: "my-ballot.dot", seq: 0 }),
      ev({ name: "DeployPointAwarded", app: "my-ballot.dot", actor: B, seq: 1 }),
      ev({ name: "ModPointAwarded", app: "my-ballot.dot", actor: B, source: "ballot.dot", seq: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "mod",
      app: "my-ballot.dot",
      actor: B,
      source: "ballot.dot",
    });
  });

  it("maps a star and an unstar", () => {
    expect(reduceEvents([ev({ name: "StarPointAwarded", app: "kudos.dot", actor: A })])[0]).toMatchObject({
      kind: "star",
      app: "kudos.dot",
      actor: A,
    });
    expect(reduceEvents([ev({ name: "StarPointRefunded", app: "kudos.dot", actor: A })])[0]).toMatchObject({
      kind: "unstar",
      app: "kudos.dot",
    });
  });

  it("keeps actions on different apps in the same block as separate events", () => {
    const out = reduceEvents([
      ev({ name: "Published", app: "chess.dot", seq: 0 }),
      ev({ name: "DeployPointAwarded", app: "chess.dot", actor: A, seq: 1 }),
      ev({ name: "StarPointAwarded", app: "kudos.dot", actor: B, seq: 2 }),
    ]);
    expect(out).toHaveLength(2);
    const kinds = out.map((e) => e.kind).sort();
    expect(kinds).toEqual(["deploy", "star"]);
  });

  it("maps standalone legacy events (pin, unpublish, visibility)", () => {
    expect(reduceEvents([ev({ name: "Pinned", app: "x.dot" })])[0].kind).toBe("pin");
    expect(reduceEvents([ev({ name: "Unpublished", app: "x.dot" })])[0].kind).toBe("unpublish");
    expect(reduceEvents([ev({ name: "VisibilityChanged", app: "x.dot" })])[0].kind).toBe("visibility");
  });

  it("preserves block ordering and is stable within a block by seq", () => {
    const out = reduceEvents([
      ev({ name: "StarPointAwarded", app: "b.dot", actor: A, blockKey: "200", seq: 1 }),
      ev({ name: "Published", app: "a.dot", blockKey: "100", seq: 0 }),
      ev({ name: "DeployPointAwarded", app: "a.dot", actor: A, blockKey: "100", seq: 1 }),
    ]);
    expect(out.map((e) => e.app)).toEqual(["a.dot", "b.dot"]);
  });
});

const le = (partial: Partial<LogicalEvent> & Pick<LogicalEvent, "app" | "blockKey">): LogicalEvent => ({
  kind: "deploy",
  ...partial,
});

describe("createBlockDeduper", () => {
  it("drops a (block, app) already emitted in a prior delivery", () => {
    const dedupe = createBlockDeduper();
    const first = le({ app: "chess.dot", blockKey: "100" });
    expect(dedupe([first])).toHaveLength(1);
    // The host re-delivers the same finalized block — must be dropped.
    expect(dedupe([le({ app: "chess.dot", blockKey: "100" })])).toHaveLength(0);
  });

  it("dedupes repeats within a single delivery too", () => {
    const dedupe = createBlockDeduper();
    const out = dedupe([
      le({ app: "chess.dot", blockKey: "100" }),
      le({ app: "chess.dot", blockKey: "100" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps the same app in a different block", () => {
    const dedupe = createBlockDeduper();
    dedupe([le({ app: "chess.dot", blockKey: "100" })]);
    expect(dedupe([le({ app: "chess.dot", blockKey: "101" })])).toHaveLength(1);
  });

  it("keeps distinct apps in the same block", () => {
    const dedupe = createBlockDeduper();
    const out = dedupe([
      le({ app: "chess.dot", blockKey: "100" }),
      le({ app: "kudos.dot", blockKey: "100" }),
    ]);
    expect(out.map((e) => e.app)).toEqual(["chess.dot", "kudos.dot"]);
  });

  it("evicts the oldest key past capacity so the set stays bounded", () => {
    const dedupe = createBlockDeduper(2);
    dedupe([le({ app: "a.dot", blockKey: "1" })]); // [a@1]
    dedupe([le({ app: "b.dot", blockKey: "2" })]); // [a@1, b@2]
    dedupe([le({ app: "c.dot", blockKey: "3" })]); // evicts a@1 -> [b@2, c@3]
    // b@2 and c@3 are still in the window (skipped, so no eviction either).
    expect(dedupe([le({ app: "b.dot", blockKey: "2" })])).toHaveLength(0);
    expect(dedupe([le({ app: "c.dot", blockKey: "3" })])).toHaveLength(0);
    // a@1 fell out of the window, so it's allowed through again.
    expect(dedupe([le({ app: "a.dot", blockKey: "1" })])).toHaveLength(1);
  });
});
