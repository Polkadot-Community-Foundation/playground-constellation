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

import { getChainHandle, type ChainMode } from "./client.ts";
import { decodeIdentityRecipient, decodeModPoint, decodePointAward, decodeStarPoint } from "./decode.ts";
import { reduceEvents } from "./dedup.ts";
import {
  eventNameForTopic,
  IDENTITY_EVENTS,
  TYPED_PAYLOAD_EVENTS,
  type RegistryEvent,
} from "./events.ts";
import { resolveNames } from "./names.ts";
import type { ConstellationHandlers, RelabelEvent } from "./source.ts";
import type { NormalizedEvent } from "./types.ts";

const RELABEL_DEBOUNCE_MS = 1200;

function hexOf(v: unknown): string {
  const o = v as { toHex?: () => string; asHex?: () => string };
  return o?.toHex?.() ?? o?.asHex?.() ?? String(v);
}

/** Unwrap PAPI's data field to raw bytes (it may be a Binary wrapper). */
function bytesOf(v: unknown): Uint8Array {
  const o = v as { asBytes?: () => Uint8Array };
  return o?.asBytes?.() ?? (v as Uint8Array);
}

// Rate-limit warnings so a stuck WS can't flood an unattended kiosk's console.
let lastWarn = 0;
function warnThrottled(msg: string, err: unknown): void {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn(msg, err);
}

function normalize(name: RegistryEvent, data: Uint8Array, seq: number, blockKey: string): NormalizedEvent {
  if (TYPED_PAYLOAD_EVENTS.has(name)) {
    if (name === "ModPointAwarded") {
      const p = decodeModPoint(data);
      return { name, app: p.modDomain, actor: p.modder, source: p.source, blockKey, seq };
    }
    if (name === "StarPointAwarded" || name === "StarPointRefunded") {
      const p = decodeStarPoint(data);
      return { name, app: p.domain, actor: p.voter, blockKey, seq };
    }
    const p = decodePointAward(data);
    return { name, app: p.domain, actor: p.recipient, blockKey, seq };
  }
  // Legacy events carry the domain as raw UTF-8 bytes.
  return { name, app: new TextDecoder().decode(data), blockKey, seq };
}

/** Shape of one ContractEmitted entry from the `Revive.ContractEmitted` watch. */
interface ContractEmitted {
  payload: { contract: unknown; topics?: unknown[]; data: unknown };
}

/**
 * Scan one block's ContractEmitted events and collect the lowercased recipient
 * addresses of identity events (`IdentityLinked` / `IdentityCleared`) emitted by
 * the target registry. Registry v17 identity events carry the affected address
 * (`Address(20)` prefix), so we relabel precisely — no `getTopBuilders` poll.
 */
export function identityRecipientsInBlock(
  events: ReadonlyArray<ContractEmitted>,
  target: string,
): Set<string> {
  const out = new Set<string>();
  for (const ev of events) {
    const p = ev.payload;
    if (hexOf(p.contract).toLowerCase() !== target) continue;
    const topics = p.topics ?? [];
    if (topics.length === 0) continue;
    const name = eventNameForTopic(hexOf(topics[0]));
    if (!name || !IDENTITY_EVENTS.has(name)) continue;
    try {
      out.add(decodeIdentityRecipient(bytesOf(p.data)).toLowerCase());
    } catch (err) {
      warnThrottled("[constellation] identity event decode failed", err);
    }
  }
  return out;
}

/** Emit one RelabelEvent per resolved address (a `null` username clears the label). */
export function emitRelabels(
  usernames: Record<string, string | null>,
  ts: number,
  onRelabel: (r: RelabelEvent) => void,
): void {
  for (const [address, username] of Object.entries(usernames)) {
    onRelabel({ address, username, ts });
  }
}

/**
 * Subscribe to live registry events through the host. `watch()` emits one
 * notification per finalized block with all its ContractEmitted events, so a
 * deploy's burst is grouped naturally and reduced into one logical event.
 *
 * Identity events (`IdentityLinked` / `IdentityCleared`) carry the affected
 * recipient address, so we accumulate recipients across a debounce window,
 * resolve just those addresses' names, and emit a RelabelEvent per address.
 */
export function subscribeLive(mode: ChainMode, handlers: ConstellationHandlers): () => void {
  const { onEvent, onRelabel } = handlers;
  let cancelled = false;
  let unsub: (() => void) | null = null;
  let relabelTimer: ReturnType<typeof setTimeout> | null = null;

  getChainHandle(mode)
    .then(({ api, registry, registryAddress, individuality }) => {
      if (cancelled) return;
      const target = registryAddress.toLowerCase();

      // Recipients of identity events seen since the last debounced flush.
      const pending = new Set<string>();
      const scheduleRelabel = (): void => {
        if (!onRelabel || relabelTimer !== null) return;
        relabelTimer = setTimeout(async () => {
          relabelTimer = null;
          const addrs = [...pending];
          pending.clear();
          if (addrs.length === 0) return;
          try {
            const usernames = await resolveNames(registry, individuality, addrs);
            emitRelabels(usernames, Date.now(), onRelabel);
          } catch (err) {
            warnThrottled("[constellation] relabel resolve failed", err);
          }
        }, RELABEL_DEBOUNCE_MS);
      };

      const sub = api.event.Revive.ContractEmitted.watch().subscribe({
        next: ({ block, events }) => {
          const blockKey = String(block.number);
          const batch: NormalizedEvent[] = [];
          let seq = 0;
          for (const ev of events) {
            const p = ev.payload;
            if (hexOf(p.contract).toLowerCase() !== target) continue;
            const topics = p.topics ?? [];
            if (topics.length === 0) continue;
            const name = eventNameForTopic(hexOf(topics[0]));
            if (!name) continue;
            // Identity events are handled separately (recipient-carrying, no domain).
            if (IDENTITY_EVENTS.has(name)) continue;
            try {
              batch.push(normalize(name, bytesOf(p.data), seq++, blockKey));
            } catch (err) {
              warnThrottled("[constellation] event decode failed", err);
            }
          }

          const recipients = identityRecipientsInBlock(events, target);
          if (recipients.size > 0) {
            for (const r of recipients) pending.add(r);
            scheduleRelabel();
          }

          if (batch.length === 0) return;
          const ts = Date.now();
          if (onEvent) {
            for (const le of reduceEvents(batch)) onEvent({ event: le, ts });
          }
        },
        error: (err: unknown) => warnThrottled("[constellation] subscription error", err),
      });
      unsub = () => sub.unsubscribe();
    })
    .catch((err) => console.warn("[constellation] live subscribe failed", err));

  return () => {
    cancelled = true;
    if (relabelTimer !== null) clearTimeout(relabelTimer);
    unsub?.();
  };
}
