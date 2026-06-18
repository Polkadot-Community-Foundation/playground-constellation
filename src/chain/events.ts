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

import { bytesToHex, keccak256, utf8ToBytes } from "@parity/product-sdk-utils";

// These names are the canonical source of truth for event topics: each topic
// is `keccak256(name)`, so a name must match the contract's emitted event
// exactly. cdm.json's ABI is functions-only (revive/PolkaVM events aren't in
// the Solidity ABI array), so it CANNOT verify these — the authority is the
// registry contract (`lib.rs` in paritytech/playground-app) and that repo's
// `utils/event-stream/registryEvents.ts`. A rename there silently breaks
// decoding here with no test failure; keep them in sync on every redeploy.
/** All event names the registry emits. Order is not significant. */
export const EVENT_NAMES = [
  "Published",
  "Unpublished",
  "Rated",
  "RatingRemoved",
  "VisibilityChanged",
  "Pinned",
  "Unpinned",
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
  "ModPointAwarded",
  "StarPointAwarded",
  "StarPointRefunded",
  "IdentityLinked",
  "IdentityCleared",
] as const;

export type RegistryEvent = (typeof EVENT_NAMES)[number];

/**
 * Events whose `data` is a SCALE-encoded typed payload (recipient + domain,
 * possibly more). The rest carry a single string as raw UTF-8 bytes — domain
 * for the raw-domain events, username for the username events.
 */
export const TYPED_PAYLOAD_EVENTS: ReadonlySet<RegistryEvent> = new Set<RegistryEvent>([
  "DeployPointAwarded",
  "PlaygroundPublishPointAwarded",
  "ModdablePointAwarded",
  "ModPointAwarded",
  "StarPointAwarded",
  "StarPointRefunded",
]);

/**
 * Identity events (registry v17 `set_identity` / `clear_identity`). Payload is
 * `IdentityEvent { recipient: Address(20), root_pubkey: [u8;32] }` — the
 * affected address IS included (unlike the old username events), so the live
 * listener can relabel just that address (see `decodeIdentityRecipient`).
 */
export const IDENTITY_EVENTS: ReadonlySet<RegistryEvent> = new Set<RegistryEvent>([
  "IdentityLinked",
  "IdentityCleared",
]);

/** `topic[0]` for an event: keccak256 of the bare event name (matches the contract). */
export function topicForEvent(name: RegistryEvent): `0x${string}` {
  return ("0x" + bytesToHex(keccak256(utf8ToBytes(name)))) as `0x${string}`;
}

const TOPIC_TO_NAME: ReadonlyMap<string, RegistryEvent> = new Map(
  EVENT_NAMES.map((name) => [topicForEvent(name).toLowerCase(), name]),
);

/** Resolve a `topic[0]` hex string back to an event name, or undefined if unknown. */
export function eventNameForTopic(topicHex: string): RegistryEvent | undefined {
  return TOPIC_TO_NAME.get(topicHex.toLowerCase());
}