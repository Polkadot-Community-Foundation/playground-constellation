import type { LogicalEvent } from "../chain/types.ts";

export type Effect =
  | { type: "birth"; nodeId: string; start: number }
  | { type: "pulse"; nodeId: string; start: number }
  | { type: "lineage"; from: string; to: string; start: number }
  | { type: "star"; from: string; to: string; start: number };

export const EFFECT_DURATION: Record<Effect["type"], number> = {
  birth: 1400,
  pulse: 1200,
  lineage: 1800,
  star: 1100,
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

/** Drop effects whose animation window has elapsed. */
export function pruneEffects(effects: Effect[], now: number): Effect[] {
  return effects.filter((fx) => now - fx.start < EFFECT_DURATION[fx.type]);
}
