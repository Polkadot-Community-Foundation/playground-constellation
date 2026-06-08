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

import type { LogicalEvent } from "../chain/types.ts";

export type Effect =
  | { type: "birth"; nodeId: string; start: number }
  | { type: "pulse"; nodeId: string; start: number }
  | { type: "lineage"; from: string; to: string; start: number }
  | { type: "star"; from: string; to: string; start: number }
  // Gold comets that keep the sky alive between real events: `highlightStar`
  // accompanies a polled highlight (leaderboard, recent publish, app count);
  // `ambientStar` is a slower, fainter drift fired on a timer during quiet
  // stretches. Both arc between two existing nodes.
  | { type: "highlightStar"; from: string; to: string; start: number }
  | { type: "ambientStar"; from: string; to: string; start: number };

export const EFFECT_DURATION: Record<Effect["type"], number> = {
  birth: 1400,
  pulse: 1200,
  lineage: 1800,
  star: 1100,
  highlightStar: 1500,
  ambientStar: 2200,
};

/** Translate a logical event into the transient animations it should trigger. */
export function effectsForEvent(e: LogicalEvent, now: number): Effect[] {
  switch (e.kind) {
    case "deploy":
      return [
        { type: "birth", nodeId: e.app, start: now },
        { type: "pulse", nodeId: e.app, start: now },
      ];
    case "mod": {
      const fx: Effect[] = [
        { type: "birth", nodeId: e.app, start: now },
        { type: "pulse", nodeId: e.app, start: now },
      ];
      if (e.source) fx.push({ type: "lineage", from: e.source, to: e.app, start: now });
      return fx;
    }
    case "star":
      return e.actor
        ? [{ type: "star", from: e.actor.toLowerCase(), to: e.app, start: now }, { type: "pulse", nodeId: e.app, start: now }]
        : [{ type: "pulse", nodeId: e.app, start: now }];
    default:
      return [{ type: "pulse", nodeId: e.app, start: now }];
  }
}

function randomOther(nodeIds: string[], not: string): string | null {
  const others = nodeIds.filter((id) => id !== not);
  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)]!;
}

/**
 * A gold comet arcing from a random other node into `target`. Used when a
 * highlight points at a node that exists on the canvas (leader, recent app).
 */
export function cometToward(
  target: string,
  nodeIds: string[],
  variant: "highlightStar" | "ambientStar",
  now: number,
): Effect | null {
  const from = randomOther(nodeIds, target);
  if (!from) return null;
  return { type: variant, from, to: target, start: now };
}

/**
 * A gold comet between two distinct random nodes. Used for node-less
 * highlights (app count) and for the idle ambient drift.
 */
export function cometBetween(
  nodeIds: string[],
  variant: "highlightStar" | "ambientStar",
  now: number,
): Effect | null {
  if (nodeIds.length < 2) return null;
  const from = nodeIds[Math.floor(Math.random() * nodeIds.length)]!;
  const to = randomOther(nodeIds, from);
  if (!to) return null;
  return { type: variant, from, to, start: now };
}

/** Drop effects whose animation window has elapsed. */
export function pruneEffects(effects: Effect[], now: number): Effect[] {
  return effects.filter((fx) => now - fx.start < EFFECT_DURATION[fx.type]);
}