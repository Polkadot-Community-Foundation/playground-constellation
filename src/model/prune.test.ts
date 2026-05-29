import { describe, expect, it } from "vitest";
import { applyEvent, applySnapshot, createGraph, pruneGraph, type GraphSnapshot } from "./graph.ts";

const ADDR = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(20);
const B1 = ADDR(0x21);
const B2 = ADDR(0x22);
const B3 = ADDR(0x23);
const B_OLD = ADDR(0x2a);
const CYCLE = [B1, B2, B3];

function seededWithPinned(): ReturnType<typeof createGraph> {
  const g = createGraph();
  const snap: GraphSnapshot = {
    apps: [
      { domain: "root-a.dot", owner: ADDR(1), stars: 5, mods: 3, pinned: true },
      { domain: "root-b.dot", owner: ADDR(2), stars: 4, mods: 2, pinned: true },
    ],
    builders: [
      { address: ADDR(1), xp: 100, username: "alice" },
      { address: ADDR(2), xp: 80, username: "bob" },
    ],
    lineage: [],
    usernames: {},
  };
  applySnapshot(g, snap);
  return g;
}

// 400 deploys: app-0 owned by a builder that owns *only* it (B_OLD); the rest
// cycle through three shared builders (the realistic case).
function withDeploys(g: ReturnType<typeof createGraph>, n = 400): void {
  for (let i = 0; i < n; i++) {
    const owner = i === 0 ? B_OLD : CYCLE[i % CYCLE.length];
    applyEvent(g, { kind: "deploy", app: `app-${i}.dot`, actor: owner, blockKey: String(i) }, i);
  }
}

describe("pruneGraph", () => {
  it("graph grows unbounded without pruning (demonstrates the leak)", () => {
    const g = seededWithPinned();
    withDeploys(g);
    expect(g.nodes.size).toBeGreaterThan(400);
  });

  it("bounds nodes to the cap, keeping pinned roots and the most-recent apps", () => {
    const g = seededWithPinned();
    withDeploys(g);
    pruneGraph(g, 100);
    expect(g.nodes.size).toBeLessThanOrEqual(100);
    expect(g.nodes.has("root-a.dot")).toBe(true);
    expect(g.nodes.has("root-b.dot")).toBe(true);
    expect(g.nodes.has("app-399.dot")).toBe(true);
    expect(g.nodes.has("app-0.dot")).toBe(false);
  });

  it("keeps builders that still own a surviving app (cyan stays visible)", () => {
    const g = seededWithPinned();
    withDeploys(g);
    pruneGraph(g, 100);
    expect(g.nodes.has(B1.toLowerCase())).toBe(true);
    expect(g.nodes.has(B2.toLowerCase())).toBe(true);
    expect(g.nodes.has(B3.toLowerCase())).toBe(true);
  });

  it("removes builders orphaned by pruning", () => {
    const g = seededWithPinned();
    withDeploys(g);
    pruneGraph(g, 100);
    // B_OLD owned only app-0, which was evicted → it is now orphaned.
    expect(g.nodes.has(B_OLD.toLowerCase())).toBe(false);
  });

  it("never leaves an edge referencing a removed node", () => {
    const g = seededWithPinned();
    withDeploys(g);
    pruneGraph(g, 50);
    for (const edge of g.edges.values()) {
      expect(g.nodes.has(edge.from)).toBe(true);
      expect(g.nodes.has(edge.to)).toBe(true);
    }
  });

  it("is a no-op when under the cap", () => {
    const g = seededWithPinned();
    applyEvent(g, { kind: "deploy", app: "x.dot", actor: B1, blockKey: "1" }, 1);
    const before = g.nodes.size;
    pruneGraph(g, 1000);
    expect(g.nodes.size).toBe(before);
  });
});
