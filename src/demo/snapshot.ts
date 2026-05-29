// Curated starting graph for the summit demo recording.
// Designed to look like a busy-but-readable constellation at first paint.

import type { GraphSnapshot } from "../model/graph.ts";

const addr = (seed: string) => {
  // Deterministic 40-hex address derived from a seed string so the same
  // builder always gets the same address across reloads (helps the cache).
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let out = "";
  let x = h;
  for (let i = 0; i < 40; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out += (x & 0xf).toString(16);
  }
  return "0x" + out;
};

interface DemoBuilder {
  handle: string | null;
  address: string;
  xp: number;
}

// Each builder is intended to live in *one* root family so the constellation
// reads as separate clusters held together only by their root + lineage,
// instead of one big tangled component. Comments call out the home cluster.
const BUILDERS_RAW: { handle: string | null; xp: number }[] = [
  // Root owners — one per family.
  { handle: "alice", xp: 412 },          // rock-paper-scissors
  { handle: "cosmic-builder", xp: 318 }, // the-ballot
  { handle: "bob", xp: 256 },            // kudos
  { handle: "parity-charles", xp: 224 }, // countdown
  { handle: "swift-zebra", xp: 188 },    // dot-link
  { handle: "neon-fox", xp: 165 },       // pixel-press
  { handle: "midnight-otter", xp: 132 }, // snake-arena

  // Second-tier fans — each anchored to one family.
  { handle: "dot-druid", xp: 118 },      // ballot
  { handle: "rust-raven", xp: 96 },      // kudos
  { handle: "polar-axiom", xp: 78 },     // rps
  { handle: "ink-mage", xp: 64 },        // countdown
  { handle: "luna", xp: 52 },            // rps
  { handle: "kappa-quark", xp: 41 },     // pixel
  { handle: "vega", xp: 33 },            // snake
  { handle: "tinker-tess", xp: 27 },     // ballot

  // Leaf builders — each owns a single app to dangle off its cluster.
  { handle: "echo-otto", xp: 22 },       // ballot (nova-poll)
  { handle: "drift-jin", xp: 19 },       // kudos (drift-board)
  { handle: "halcyon", xp: 16 },         // dot-link (dot-link-pro)
  { handle: "pixel-pip", xp: 14 },       // pixel (pixel-canvas)
  { handle: "snake-syl", xp: 11 },       // snake (snake-coop)
  { handle: null, xp: 9 },               // rps (blitz-rps)
  { handle: null, xp: 6 },               // standalone deploy (echo-chamber)
];

export const DEMO_BUILDERS: DemoBuilder[] = BUILDERS_RAW.map((b, i) => ({
  ...b,
  address: addr(b.handle ?? `anon-${i}`),
}));

/**
 * Lookup by handle for the script. Unknown handles (e.g. "anon-20") derive a
 * stable address from the same hash used for the seeded anonymous builders,
 * so script references and snapshot builders resolve to identical addresses.
 */
export function builderAddr(handle: string): string {
  return DEMO_BUILDERS.find((b) => b.handle === handle)?.address ?? addr(handle);
}

interface DemoApp {
  domain: string;
  ownerHandle: string;
  stars: number;
  mods: number;
  pinned: boolean;
}

const APPS_RAW: DemoApp[] = [
  // Each app's owner is intentionally kept inside its root family, so the
  // ownership edges form clusters around each root instead of bridging
  // unrelated families. Lineage chains further reinforce that grouping.

  // --- rock-paper-scissors family ---
  { domain: "rock-paper-scissors.dot", ownerHandle: "alice", stars: 14, mods: 9, pinned: true },
  { domain: "my-chess.dot", ownerHandle: "polar-axiom", stars: 3, mods: 1, pinned: false },
  { domain: "tournament-rps.dot", ownerHandle: "luna", stars: 3, mods: 2, pinned: false },
  { domain: "speed-rps.dot", ownerHandle: "polar-axiom", stars: 2, mods: 1, pinned: false },
  { domain: "blitz-rps.dot", ownerHandle: "anon-20", stars: 1, mods: 0, pinned: false },

  // --- the-ballot family ---
  { domain: "the-ballot.dot", ownerHandle: "cosmic-builder", stars: 11, mods: 8, pinned: true },
  { domain: "speed-ballot.dot", ownerHandle: "dot-druid", stars: 4, mods: 3, pinned: false },
  { domain: "ranked-ballot.dot", ownerHandle: "tinker-tess", stars: 3, mods: 2, pinned: false },
  { domain: "ballot-plus.dot", ownerHandle: "tinker-tess", stars: 1, mods: 0, pinned: false },
  { domain: "team-quest.dot", ownerHandle: "tinker-tess", stars: 1, mods: 0, pinned: false },
  { domain: "nova-poll.dot", ownerHandle: "echo-otto", stars: 1, mods: 0, pinned: false },

  // --- kudos family ---
  { domain: "kudos.dot", ownerHandle: "bob", stars: 9, mods: 7, pinned: true },
  { domain: "team-kudos.dot", ownerHandle: "rust-raven", stars: 3, mods: 2, pinned: false },
  { domain: "guild-kudos.dot", ownerHandle: "rust-raven", stars: 2, mods: 1, pinned: false },
  { domain: "guild-board.dot", ownerHandle: "rust-raven", stars: 0, mods: 0, pinned: false },
  { domain: "drift-board.dot", ownerHandle: "drift-jin", stars: 0, mods: 0, pinned: false },

  // --- countdown family ---
  { domain: "countdown.dot", ownerHandle: "parity-charles", stars: 7, mods: 6, pinned: true },
  { domain: "10s-countdown.dot", ownerHandle: "ink-mage", stars: 2, mods: 1, pinned: false },
  { domain: "race-countdown.dot", ownerHandle: "ink-mage", stars: 1, mods: 0, pinned: false },

  // --- dot-link family ---
  { domain: "dot-link.dot", ownerHandle: "swift-zebra", stars: 6, mods: 4, pinned: true },
  { domain: "dot-link-pro.dot", ownerHandle: "halcyon", stars: 1, mods: 0, pinned: false },

  // --- pixel-press family ---
  { domain: "pixel-press.dot", ownerHandle: "neon-fox", stars: 5, mods: 5, pinned: true },
  { domain: "pixel-quest.dot", ownerHandle: "kappa-quark", stars: 2, mods: 1, pinned: false },
  { domain: "pixel-press-mini.dot", ownerHandle: "kappa-quark", stars: 1, mods: 0, pinned: false },
  { domain: "pixel-canvas.dot", ownerHandle: "pixel-pip", stars: 0, mods: 0, pinned: false },

  // --- snake-arena family ---
  { domain: "snake-arena.dot", ownerHandle: "midnight-otter", stars: 4, mods: 4, pinned: true },
  { domain: "neon-snake.dot", ownerHandle: "vega", stars: 1, mods: 1, pinned: false },
  { domain: "snake-arcade.dot", ownerHandle: "vega", stars: 1, mods: 0, pinned: false },
  { domain: "snake-coop.dot", ownerHandle: "snake-syl", stars: 0, mods: 0, pinned: false },

  // --- standalone deploy (no family) — a single anon's lone app ---
  { domain: "echo-chamber.dot", ownerHandle: "anon-21", stars: 0, mods: 0, pinned: false },
];

export const DEMO_APPS = APPS_RAW;

// Lineage: which mods descend from which root/parent. More edges than before
// so the mod-descent story is visible from across the room.
const LINEAGE_HANDLES: { child: string; source: string }[] = [
  // off the-ballot
  { child: "speed-ballot.dot", source: "the-ballot.dot" },
  { child: "ranked-ballot.dot", source: "the-ballot.dot" },
  { child: "nova-poll.dot", source: "the-ballot.dot" },
  { child: "ballot-plus.dot", source: "speed-ballot.dot" },

  // off kudos
  { child: "team-kudos.dot", source: "kudos.dot" },
  { child: "guild-kudos.dot", source: "kudos.dot" },
  { child: "drift-board.dot", source: "kudos.dot" },
  { child: "guild-board.dot", source: "team-kudos.dot" },

  // off rock-paper-scissors
  { child: "my-chess.dot", source: "rock-paper-scissors.dot" },
  { child: "tournament-rps.dot", source: "rock-paper-scissors.dot" },
  { child: "speed-rps.dot", source: "rock-paper-scissors.dot" },
  { child: "blitz-rps.dot", source: "tournament-rps.dot" },

  // off countdown
  { child: "10s-countdown.dot", source: "countdown.dot" },
  { child: "race-countdown.dot", source: "countdown.dot" },

  // off pixel-press
  { child: "pixel-quest.dot", source: "pixel-press.dot" },
  { child: "pixel-press-mini.dot", source: "pixel-press.dot" },
  { child: "pixel-canvas.dot", source: "pixel-quest.dot" },

  // off snake-arena
  { child: "neon-snake.dot", source: "snake-arena.dot" },
  { child: "snake-arcade.dot", source: "snake-arena.dot" },
  { child: "snake-coop.dot", source: "neon-snake.dot" },

  // off dot-link
  { child: "dot-link-pro.dot", source: "dot-link.dot" },

  // a leaf off ranked-ballot for a deeper chain
  { child: "team-quest.dot", source: "ranked-ballot.dot" },
];

export const DEMO_LINEAGE = LINEAGE_HANDLES;

export function buildDemoSnapshot(): GraphSnapshot {
  const usernames: Record<string, string | null> = {};
  for (const b of DEMO_BUILDERS) usernames[b.address] = b.handle;

  const apps = DEMO_APPS.map((a) => ({
    domain: a.domain,
    owner: builderAddr(a.ownerHandle),
    stars: a.stars,
    mods: a.mods,
    pinned: a.pinned,
  }));

  const builders = DEMO_BUILDERS.map((b) => ({
    address: b.address,
    xp: b.xp,
    username: b.handle,
  }));

  const lineage = DEMO_LINEAGE.map((l) => ({ child: l.child, source: l.source }));

  return { apps, builders, lineage, usernames };
}
