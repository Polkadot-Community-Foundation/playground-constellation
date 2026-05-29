// Scripted event sequence for the summit demo. Loops indefinitely so the
// kiosk stays alive during a recording session. Timing is varied (1.4s – 3.8s)
// to feel organic — bursty moments interleaved with quiet beats.

import type { LogicalEvent } from "../chain/types.ts";
import { builderAddr } from "./snapshot.ts";

interface ScriptedEvent {
  /** Milliseconds to wait *after the previous event* before emitting this one. */
  delay: number;
  build: (blockKey: string) => LogicalEvent;
}

const star = (handle: string, app: string): ScriptedEvent["build"] => (blockKey) => ({
  kind: "star",
  app,
  actor: builderAddr(handle),
  blockKey,
});

const mod = (handle: string, child: string, source: string): ScriptedEvent["build"] => (blockKey) => ({
  kind: "mod",
  app: child,
  actor: builderAddr(handle),
  source,
  blockKey,
});

const deploy = (handle: string, app: string, moddable = true): ScriptedEvent["build"] => (blockKey) => ({
  kind: "deploy",
  app,
  actor: builderAddr(handle),
  moddable,
  blockKey,
});

const rate = (handle: string, app: string): ScriptedEvent["build"] => (blockKey) => ({
  kind: "rate",
  app,
  actor: builderAddr(handle),
  blockKey,
});

/**
 * The script. Roughly 90 seconds end-to-end, then it loops. Designed so that
 * (a) every visible cluster sees activity, (b) there are mini-stories: a viral
 * burst on rock-paper-scissors, a mod chain off the ballot, a fresh deploy
 * picked up by a couple of stars.
 */
// Every `mod` and `deploy` keeps the actor inside the target app's root
// family, so live events never bridge clusters. Stars are cross-family fine —
// they don't create edges, only animations.
export const SCRIPT: ScriptedEvent[] = [
  // Warm opener — a fresh standalone deploy
  { delay: 1800, build: deploy("anon-22", "pulse-app.dot", true) },
  { delay: 2000, build: star("vega", "pulse-app.dot") },

  // First mod chain — off the-ballot (ballot natives only)
  { delay: 2400, build: mod("dot-druid", "live-ballot.dot", "the-ballot.dot") },
  { delay: 1900, build: star("cosmic-builder", "live-ballot.dot") },
  { delay: 2300, build: mod("tinker-tess", "civic-ballot.dot", "live-ballot.dot") },

  // Second mod chain — off rock-paper-scissors (rps natives)
  { delay: 2500, build: mod("luna", "tournament-rps-pro.dot", "tournament-rps.dot") },
  { delay: 2100, build: star("bob", "tournament-rps-pro.dot") },
  { delay: 2400, build: mod("polar-axiom", "rps-arena.dot", "speed-rps.dot") },

  // A quiet beat + cross-cluster star (no edge — just an animation)
  { delay: 2800, build: star("tinker-tess", "rock-paper-scissors.dot") },

  // Countdown deploy + countdown-native mod
  { delay: 2400, build: deploy("parity-charles", "drift-quest.dot", true) },
  { delay: 1900, build: mod("ink-mage", "drift-quest-coop.dot", "drift-quest.dot") },
  { delay: 2100, build: star("alice", "drift-quest.dot") },

  // Mod chain off kudos (kudos natives)
  { delay: 2300, build: mod("rust-raven", "team-shoutout.dot", "team-kudos.dot") },
  { delay: 1900, build: mod("rust-raven", "guild-shoutout.dot", "guild-kudos.dot") },
  { delay: 2200, build: star("bob", "team-shoutout.dot") },

  // Pixel branch (pixel natives)
  { delay: 2500, build: mod("kappa-quark", "pixel-studio.dot", "pixel-press.dot") },
  { delay: 1900, build: star("neon-fox", "pixel-studio.dot") },
  { delay: 2400, build: mod("pixel-pip", "pixel-board.dot", "pixel-quest.dot") },

  // Snake branch (snake natives)
  { delay: 2200, build: mod("vega", "snake-rush.dot", "neon-snake.dot") },
  { delay: 2000, build: star("snake-syl", "snake-rush.dot") },

  // Countdown branch deepens
  { delay: 2400, build: mod("ink-mage", "race-countdown-v2.dot", "race-countdown.dot") },
  { delay: 1900, build: star("kappa-quark", "race-countdown-v2.dot") },

  // Deeper mod off ranked-ballot
  { delay: 2600, build: mod("tinker-tess", "team-quest-plus.dot", "team-quest.dot") },

  // dot-link branch comes alive
  { delay: 2400, build: deploy("swift-zebra", "link-board.dot", true) },
  { delay: 1800, build: mod("halcyon", "link-feed.dot", "link-board.dot") },
  { delay: 2000, build: star("cosmic-builder", "link-board.dot") },

  // A small spray of stars (no edges, just life)
  { delay: 2300, build: star("rust-raven", "the-ballot.dot") },
  { delay: 2400, build: star("ink-mage", "kudos.dot") },
  { delay: 2200, build: rate("alice", "tournament-rps-pro.dot") },

  // Closing — a brand new standalone leaf
  { delay: 2700, build: deploy("anon-23", "spark-poll.dot", false) },
  { delay: 2200, build: star("neon-fox", "spark-poll.dot") },
  { delay: 2500, build: star("bob", "link-feed.dot") },
];
