import type { RegistryEvent } from "./events.ts";

/** One decoded contract event, before per-action collapsing. */
export interface NormalizedEvent {
  name: RegistryEvent;
  /** The affected app domain (for a mod, the new child domain). */
  app: string;
  /** Relevant address: point recipient / owner, or the modder for a mod. */
  actor?: string;
  /** Source app domain (ModPointAwarded only). */
  source?: string;
  /** Groups events emitted by the same on-chain action (block or block:tx). */
  blockKey: string;
  /** Arrival order, for stable sorting within a block. */
  seq: number;
}

export type LogicalKind =
  | "deploy"
  | "mod"
  | "star"
  | "unstar"
  | "pin"
  | "unpin"
  | "publish"
  | "unpublish"
  | "rate"
  | "unrate"
  | "visibility";

/** One user action, collapsed from its burst of raw events. */
export interface LogicalEvent {
  kind: LogicalKind;
  app: string;
  actor?: string;
  source?: string;
  /** True when the deploy was moddable (ModdablePointAwarded fired) → +1 XP. */
  moddable?: boolean;
  blockKey: string;
}
