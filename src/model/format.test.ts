import { describe, expect, it } from "vitest";
import { createGraph, applySnapshot, type GraphSnapshot } from "./graph.ts";
import { describeEvent, headlineFor, labelFor } from "./format.ts";

const ALICE = "0x" + "a1".repeat(20);

function graphWith(): ReturnType<typeof createGraph> {
  const g = createGraph();
  const snap: GraphSnapshot = {
    apps: [{ domain: "the-ballot.dot", owner: ALICE, stars: 1, mods: 1, pinned: true }],
    builders: [{ address: ALICE, xp: 50, username: "alice" }],
    lineage: [],
    usernames: { [ALICE.toLowerCase()]: "alice" },
  };
  applySnapshot(g, snap);
  return g;
}

describe("labelFor", () => {
  it("resolves a builder address to its username", () => {
    expect(labelFor(graphWith(), ALICE)).toBe("alice");
  });
  it("returns the domain for an app", () => {
    expect(labelFor(graphWith(), "the-ballot.dot")).toBe("the-ballot.dot");
  });
  it("shortens an unknown address", () => {
    expect(labelFor(graphWith(), "0x" + "ee".repeat(20))).toMatch(/^0xeeee…/);
  });
});

describe("describeEvent", () => {
  it("formats a mod line with the source as the target", () => {
    const line = describeEvent(
      { kind: "mod", app: "my-ballot.dot", actor: ALICE, source: "the-ballot.dot", blockKey: "1" },
      graphWith(),
    );
    expect(line).toMatchObject({ tag: "MOD", actorLabel: "alice", targetLabel: "the-ballot.dot", xp: 1 });
  });

  it("formats a deploy line with the app as the target", () => {
    const line = describeEvent(
      { kind: "deploy", app: "chess.dot", actor: ALICE, blockKey: "1" },
      graphWith(),
    );
    expect(line).toMatchObject({ tag: "DEPLOY", actorLabel: "alice", targetLabel: "chess.dot", xp: 2 });
  });

  it("adds the moddable bonus to a moddable deploy (+3)", () => {
    const line = describeEvent(
      { kind: "deploy", app: "chess.dot", actor: ALICE, moddable: true, blockKey: "1" },
      graphWith(),
    );
    expect(line.xp).toBe(3);
  });

  it("formats a star line", () => {
    const line = describeEvent(
      { kind: "star", app: "the-ballot.dot", actor: ALICE, blockKey: "1" },
      graphWith(),
    );
    expect(line).toMatchObject({ tag: "STAR", targetLabel: "the-ballot.dot", xp: 1 });
  });
});

describe("headlineFor", () => {
  it("renders a mod sentence", () => {
    expect(
      headlineFor(
        { kind: "mod", app: "my-ballot.dot", actor: ALICE, source: "the-ballot.dot", blockKey: "1" },
        graphWith(),
      ),
    ).toBe("alice just modded the-ballot.dot");
  });

  it("renders a deploy sentence", () => {
    expect(
      headlineFor({ kind: "deploy", app: "chess.dot", actor: ALICE, blockKey: "1" }, graphWith()),
    ).toBe("alice just deployed chess.dot");
  });
});
