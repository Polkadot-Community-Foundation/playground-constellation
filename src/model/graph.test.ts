import { describe, expect, it } from "vitest";
import {
  applyEvent,
  applySnapshot,
  createGraph,
  relabelBuilder,
  type GraphSnapshot,
} from "./graph.ts";

const ALICE = "0x" + "a1".repeat(20);
const BOB = "0x" + "b2".repeat(20);

function snapshot(): GraphSnapshot {
  return {
    apps: [
      { domain: "ballot.dot", owner: ALICE, stars: 5, mods: 2, pinned: true },
      { domain: "my-ballot.dot", owner: BOB, stars: 0, mods: 0, pinned: false },
    ],
    builders: [
      { address: ALICE, xp: 100, username: "alice" },
      { address: BOB, xp: 10, username: null },
    ],
    lineage: [{ child: "my-ballot.dot", source: "ballot.dot" }],
    usernames: { [ALICE.toLowerCase()]: "alice", [BOB.toLowerCase()]: null },
  };
}

describe("applySnapshot", () => {
  it("creates app and builder nodes", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    expect(g.nodes.get("ballot.dot")?.kind).toBe("app");
    expect(g.nodes.get("my-ballot.dot")?.kind).toBe("app");
    expect(g.nodes.get(ALICE.toLowerCase())?.kind).toBe("builder");
    expect(g.nodes.get(BOB.toLowerCase())?.kind).toBe("builder");
  });

  it("labels a builder by username, falling back to a short address", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    expect(g.nodes.get(ALICE.toLowerCase())?.label).toBe("alice");
    expect(g.nodes.get(BOB.toLowerCase())?.label).toMatch(/^0xb2b2…/);
  });

  it("creates ownership edges (builder → app) and lineage edges (source → child)", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    expect(g.edges.get(`ownership:${ALICE.toLowerCase()}->ballot.dot`)).toBeDefined();
    expect(g.edges.get("lineage:ballot.dot->my-ballot.dot")).toBeDefined();
  });

  it("sizes a pinned, heavily-starred app larger than a fresh one", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    const pinned = g.nodes.get("ballot.dot")!;
    const fresh = g.nodes.get("my-ballot.dot")!;
    expect(pinned.size).toBeGreaterThan(fresh.size);
    expect(pinned.pinned).toBe(true);
  });
});

describe("applyEvent", () => {
  it("deploy: births a new app node, its owner builder, and an ownership edge", () => {
    const g = createGraph();
    applyEvent(g, { kind: "deploy", app: "chess.dot", actor: ALICE, blockKey: "1" }, 1000);
    expect(g.nodes.get("chess.dot")?.kind).toBe("app");
    expect(g.nodes.get(ALICE.toLowerCase())?.kind).toBe("builder");
    expect(g.edges.get(`ownership:${ALICE.toLowerCase()}->chess.dot`)).toBeDefined();
    expect(g.nodes.get("chess.dot")?.lastActive).toBe(1000);
  });

  it("mod: births the child app and a lineage edge from the source", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    applyEvent(
      g,
      { kind: "mod", app: "fork.dot", actor: ALICE, source: "ballot.dot", blockKey: "2" },
      2000,
    );
    expect(g.nodes.get("fork.dot")?.kind).toBe("app");
    expect(g.edges.get("lineage:ballot.dot->fork.dot")).toBeDefined();
  });

  it("star: increments the app star count and grows its size", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    const before = g.nodes.get("my-ballot.dot")!.size;
    applyEvent(g, { kind: "star", app: "my-ballot.dot", actor: ALICE, blockKey: "3" }, 3000);
    const node = g.nodes.get("my-ballot.dot")!;
    expect(node.stars).toBe(1);
    expect(node.size).toBeGreaterThan(before);
    expect(node.lastActive).toBe(3000);
  });

  it("unpublish: ghosts the node instead of removing it", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    applyEvent(g, { kind: "unpublish", app: "ballot.dot", blockKey: "4" }, 4000);
    expect(g.nodes.get("ballot.dot")?.ghost).toBe(true);
    expect(g.nodes.has("ballot.dot")).toBe(true);
  });

  it("pin / unpin: toggles the pinned flag", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    applyEvent(g, { kind: "unpin", app: "ballot.dot", blockKey: "5" }, 5000);
    expect(g.nodes.get("ballot.dot")?.pinned).toBe(false);
    applyEvent(g, { kind: "pin", app: "ballot.dot", blockKey: "6" }, 6000);
    expect(g.nodes.get("ballot.dot")?.pinned).toBe(true);
  });
});

describe("relabelBuilder", () => {
  it("renames an existing builder and reports a change", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    const changed = relabelBuilder(g, BOB, "bob");
    expect(changed).toBe(true);
    expect(g.nodes.get(BOB.toLowerCase())?.label).toBe("bob");
  });

  it("falls back to short-addr when username is null", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    relabelBuilder(g, ALICE, null);
    expect(g.nodes.get(ALICE.toLowerCase())?.label).toMatch(/^0xa1a1…/);
  });

  it("returns false when the address has no builder node", () => {
    const g = createGraph();
    expect(relabelBuilder(g, ALICE, "alice")).toBe(false);
  });

  it("returns false when the label is unchanged", () => {
    const g = createGraph();
    applySnapshot(g, snapshot());
    expect(relabelBuilder(g, ALICE, "alice")).toBe(false);
  });
});
