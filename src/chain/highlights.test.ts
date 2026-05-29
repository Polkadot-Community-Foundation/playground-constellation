import { describe, expect, it } from "vitest";
import { buildHighlights } from "./highlights.ts";

const ALICE = "0x" + "a".repeat(40);
const BOB = "0x" + "b".repeat(40);

describe("buildHighlights", () => {
  it("emits nothing for a freshly-redeployed (empty) registry", () => {
    const items = buildHighlights(
      { leader: null, recent: [], appCount: 0, usernames: new Map() },
      1,
    );
    expect(items).toEqual([]);
  });

  it("emits a leader highlight using the username when known", () => {
    const items = buildHighlights(
      {
        leader: { address: ALICE, xp: 412n },
        recent: [],
        appCount: null,
        usernames: new Map([[ALICE, "alice"]]),
      },
      100,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `leader:${ALICE}:412`,
      feedLabel: "alice leads · 412 XP",
      nodeId: ALICE,
    });
  });

  it("falls back to short-addr for an unnamed leader", () => {
    const items = buildHighlights(
      {
        leader: { address: ALICE, xp: 5n },
        recent: [],
        appCount: null,
        usernames: new Map(),
      },
      0,
    );
    expect(items[0]?.feedLabel).toContain("…");
    expect(items[0]?.feedLabel).toContain("5 XP");
  });

  it("includes recent apps and app-count when present", () => {
    const items = buildHighlights(
      {
        leader: { address: ALICE, xp: 100n },
        recent: [{ domain: "rps.dot", owner: BOB }],
        appCount: 27,
        usernames: new Map([
          [ALICE, "alice"],
          [BOB, "bob"],
        ]),
      },
      0,
    );
    const labels = items.map((i) => i.feedLabel);
    expect(labels).toContain("alice leads · 100 XP");
    expect(labels).toContain("bob → rps.dot");
    expect(labels).toContain("27 apps live");
  });

  it("skips the leader highlight when xp is zero", () => {
    const items = buildHighlights(
      {
        leader: { address: ALICE, xp: 0n },
        recent: [],
        appCount: null,
        usernames: new Map([[ALICE, "alice"]]),
      },
      0,
    );
    expect(items).toEqual([]);
  });

  it("skips app-count when registry has zero apps", () => {
    const items = buildHighlights(
      {
        leader: null,
        recent: [],
        appCount: 0,
        usernames: new Map(),
      },
      0,
    );
    expect(items).toEqual([]);
  });
});
