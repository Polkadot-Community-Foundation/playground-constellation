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
  /**
   * True when the deploy was moddable (ModdablePointAwarded fired). Tracked for
   * labelling only — under absolute-value scoring (issue #286) moddability no
   * longer affects the XP award; see xpFor in model/format.ts.
   */
  moddable?: boolean;
  blockKey: string;
}