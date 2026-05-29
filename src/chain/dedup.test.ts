import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "./types.ts";
import { reduceEvents } from "./dedup.ts";

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
