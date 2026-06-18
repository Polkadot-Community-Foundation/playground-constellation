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

import type { GraphSnapshot } from "../model/graph.ts";
import type { LogicalEvent } from "./types.ts";

export interface LoadProgress {
  done: number;
  total: number;
  label: string;
}

/** A live LogicalEvent with its wall-clock receipt time. */
export interface LiveEvent {
  event: LogicalEvent;
  ts: number;
}

/**
 * A live builder relabel — fired when an IdentityLinked/IdentityCleared event
 * on chain changes the display name for an existing builder node. `username:
 * null` means the builder cleared their identity and should fall back to
 * short-addr.
 */
export interface RelabelEvent {
  address: string;
  username: string | null;
  ts: number;
}

/**
 * A non-graph-mutating display item — used to keep the headline and feed
 * alive during quiet stretches. `nodeId`, if set, identifies an existing
 * node to pulse when this highlight surfaces.
 */
export interface Highlight {
  /** Stable id used to dedup across polls (e.g. "leader:0xabc:412"). */
  id: string;
  /** Short text for the feed pane. */
  feedLabel: string;
  /** Optional long text for the big headline. Falls back to feedLabel. */
  headline?: string;
  /** Optional graph node to pulse when this highlight is displayed. */
  nodeId?: string;
  ts: number;
}

export interface ConstellationHandlers {
  /** Graph-mutating logical events (deploy, mod, star, etc.). */
  onEvent?: (e: LiveEvent) => void;
  /** Username changes — re-label an existing builder node in place. */
  onRelabel?: (r: RelabelEvent) => void;
  /** Display-only items for headline / feed / node pulse. */
  onHighlight?: (h: Highlight) => void;
}

/**
 * Source of constellation data. The "primary" source provides the cold-load
 * snapshot AND the live event stream; auxiliary sources only emit (e.g. the
 * periodic registry-highlights poll has no snapshot). `loadSnapshot` is
 * therefore optional — auxiliaries omit it.
 */
export interface ConstellationSource {
  loadSnapshot?(onProgress?: (p: LoadProgress) => void): Promise<GraphSnapshot>;
  subscribe(handlers: ConstellationHandlers): () => void;
  /**
   * The on-chain registry address this source reads from. Used to scope the
   * localStorage cache by contract identity, so a registry redeploy (the live
   * address changes) lands in a fresh cache namespace instead of merging stale
   * nodes from the previous deployment. Only the chain source implements this;
   * mock/demo sources omit it (their data isn't cached).
   */
  getRegistryAddress?(): Promise<string>;
}