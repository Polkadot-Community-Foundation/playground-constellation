import type { GraphSnapshot } from "../model/graph.ts";
import type { ConstellationHandlers, ConstellationSource, LoadProgress } from "./source.ts";
import type { LogicalEvent } from "./types.ts";

// Deterministic-ish fake addresses keyed by handle.
const addr = (seed: number) =>
  ("0x" + seed.toString(16).padStart(2, "0").repeat(20)).toLowerCase();

const BUILDERS = [
  { handle: "alice", address: addr(0xa1), xp: 245 },
  { handle: "cosmic-builder", address: addr(0xc2), xp: 180 },
  { handle: "bob", address: addr(0xb3), xp: 140 },
  { handle: "swift-zebra", address: addr(0x5e), xp: 95 },
  { handle: "parity-charles", address: addr(0xc4), xp: 70 },
  { handle: "neon-fox", address: addr(0xf0), xp: 40 },
  { handle: null, address: addr(0xd9), xp: 15 },
];

const ROOTS = ["rock-paper-scissors.dot", "the-ballot.dot", "kudos.dot", "countdown.dot", "dot-link.dot"];

const APP_WORDS = ["chess", "dice", "tic-tac", "poll", "vote", "snake", "pixel", "quest", "arena", "spark", "echo", "drift", "nova", "pulse", "gigs", "board"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function createMockSource(): ConstellationSource {
  // Build a believable starting graph: roots owned by builders, a couple of
  // first-gen mods, and stars.
  const apps: GraphSnapshot["apps"] = [];
  const lineage: GraphSnapshot["lineage"] = [];
  const usernames: Record<string, string | null> = {};
  for (const b of BUILDERS) usernames[b.address] = b.handle;

  ROOTS.forEach((domain, i) => {
    apps.push({
      domain,
      owner: BUILDERS[i % BUILDERS.length].address,
      stars: 3 + Math.floor(Math.random() * 8),
      mods: 1 + Math.floor(Math.random() * 4),
      pinned: true,
    });
  });

  // A handful of seed mods so the tree isn't bare on first paint.
  const seedMods = ["my-chess.dot", "speed-ballot.dot", "team-kudos.dot", "10s-countdown.dot"];
  seedMods.forEach((child, i) => {
    const source = ROOTS[i % ROOTS.length];
    const owner = BUILDERS[(i + 2) % BUILDERS.length].address;
    apps.push({ domain: child, owner, stars: Math.floor(Math.random() * 4), mods: 0, pinned: false });
    lineage.push({ child, source });
  });

  const builders = BUILDERS.map((b) => ({ address: b.address, xp: b.xp, username: b.handle }));

  // Track domains that exist so live events reference real nodes.
  const liveDomains = [...ROOTS, ...seedMods];

  const loadSnapshot = async (onProgress?: (p: LoadProgress) => void): Promise<GraphSnapshot> => {
    // Simulate a few paged reads so the loading UI has something to show.
    const total = 5;
    for (let done = 1; done <= total; done++) {
      onProgress?.({ done, total, label: "loading constellation" });
      await new Promise((r) => setTimeout(r, 120));
    }
    return { apps, builders, lineage, usernames };
  };

  const subscribe = (handlers: ConstellationHandlers): (() => void) => {
    const { onEvent } = handlers;
    if (!onEvent) return () => {};
    let block = 1000;
    const timer = setInterval(() => {
      block += 1;
      const roll = Math.random();
      let event: LogicalEvent;
      if (roll < 0.4) {
        // mod: new child off an existing app
        const source = pick(liveDomains);
        const child = `${pick(APP_WORDS)}-${block % 1000}.dot`;
        const actor = pick(BUILDERS).address;
        liveDomains.push(child);
        event = { kind: "mod", app: child, actor, source, blockKey: String(block) };
      } else if (roll < 0.75) {
        // star an existing app
        event = { kind: "star", app: pick(liveDomains), actor: pick(BUILDERS).address, blockKey: String(block) };
      } else {
        // fresh deploy
        const domain = `${pick(APP_WORDS)}-${block % 1000}.dot`;
        liveDomains.push(domain);
        event = {
          kind: "deploy",
          app: domain,
          actor: pick(BUILDERS).address,
          moddable: Math.random() < 0.6,
          blockKey: String(block),
        };
      }
      onEvent({ event, ts: Date.now() });
    }, 2200);
    return () => clearInterval(timer);
  };

  return { loadSnapshot, subscribe };
}
