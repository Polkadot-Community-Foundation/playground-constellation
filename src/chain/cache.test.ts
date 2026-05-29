import { beforeEach, describe, expect, it } from "vitest";
import { applySnapshot, createGraph, type GraphSnapshot } from "../model/graph.ts";
import { loadGraph, saveGraph } from "./cache.ts";

const ALICE = "0x" + "a1".repeat(20);

function seeded() {
  const g = createGraph();
  const snap: GraphSnapshot = {
    apps: [{ domain: "ballot.dot", owner: ALICE, stars: 3, mods: 1, pinned: true }],
    builders: [{ address: ALICE, xp: 42, username: "alice" }],
    lineage: [],
    usernames: { [ALICE.toLowerCase()]: "alice" },
  };
  applySnapshot(g, snap);
  return g;
}

describe("graph cache", () => {
  beforeEach(() => localStorage.clear());

  it("returns null when nothing is cached", () => {
    expect(loadGraph()).toBeNull();
  });

  it("round-trips nodes and edges through localStorage", () => {
    saveGraph(seeded());
    const restored = loadGraph();
    expect(restored).not.toBeNull();
    expect(restored!.nodes.get("ballot.dot")?.pinned).toBe(true);
    expect(restored!.nodes.get("ballot.dot")?.stars).toBe(3);
    expect(restored!.nodes.get(ALICE.toLowerCase())?.label).toBe("alice");
    expect(restored!.edges.get(`ownership:${ALICE.toLowerCase()}->ballot.dot`)).toBeDefined();
  });

  it("survives corrupt JSON without throwing", () => {
    localStorage.setItem("constellation.graph.v1", "{not json");
    expect(loadGraph()).toBeNull();
  });
});
