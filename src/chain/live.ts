import { getChainHandle, type ChainMode } from "./client.ts";
import { decodeModPoint, decodePointAward, decodeStarPoint } from "./decode.ts";
import { reduceEvents } from "./dedup.ts";
import {
  eventNameForTopic,
  TYPED_PAYLOAD_EVENTS,
  USERNAME_EVENTS,
  type RegistryEvent,
} from "./events.ts";
import type { RegistryContract } from "./registryContract.ts";
import type { ConstellationHandlers, RelabelEvent } from "./source.ts";
import type { NormalizedEvent } from "./types.ts";

const RELABEL_DEBOUNCE_MS = 1200;
const RELABEL_BATCH_SIZE = 50;
const RELABEL_TRACK_TOP_N = 200;

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

/**
 * On UsernameSet/UsernameCleared the registry payload is just the username
 * string — the affected address isn't included. We compensate by polling
 * `getTopBuilders` for the top N accounts and diffing the resulting username
 * map against the last snapshot. A username change outside the top N is
 * dropped (rare enough not to be worth the chain cost of enumerating).
 */
async function fetchTopUsernames(registry: RegistryContract): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const topRes = await registry.getTopBuilders.query(0, RELABEL_TRACK_TOP_N);
  if (!topRes.success) return out;
  const addrs = topRes.value.map((b) => b.account.toLowerCase());
  for (let i = 0; i < addrs.length; i += RELABEL_BATCH_SIZE) {
    const chunk = addrs.slice(i, i + RELABEL_BATCH_SIZE);
    const res = await registry.getUsernames.query(chunk as `0x${string}`[]);
    if (!res.success) continue;
    chunk.forEach((a, j) => {
      const n = res.value[j] ?? "";
      out.set(a, n === "" ? null : n);
    });
  }
  return out;
}

function diffUsernames(
  prev: Map<string, string | null> | null,
  next: Map<string, string | null>,
  ts: number,
  onRelabel: (r: RelabelEvent) => void,
): void {
  // First snapshot: don't emit — we don't know what *was* there before, so we
  // can't claim anything changed. Just record the baseline.
  if (prev === null) return;
  for (const [addr, name] of next) {
    if (prev.get(addr) !== name) onRelabel({ address: addr, username: name, ts });
  }
  for (const [addr, name] of prev) {
    if (!next.has(addr) && name !== null) onRelabel({ address: addr, username: null, ts });
  }
}

/**
 * Subscribe to live registry events through the host. `watch()` emits one
 * notification per finalized block with all its ContractEmitted events, so a
 * deploy's burst is grouped naturally and reduced into one logical event.
 *
 * Username events do not appear in the LogicalEvent stream. Instead, on
 * UsernameSet/UsernameCleared we debounce a `getTopBuilders` + `getUsernames`
 * poll and emit a RelabelEvent for any account whose name changed.
 */
export function subscribeLive(mode: ChainMode, handlers: ConstellationHandlers): () => void {
  const { onEvent, onRelabel } = handlers;
  let cancelled = false;
  let unsub: (() => void) | null = null;
  let relabelTimer: ReturnType<typeof setTimeout> | null = null;
  let usernameBaseline: Map<string, string | null> | null = null;

  getChainHandle(mode)
    .then(({ api, registry, registryAddress }) => {
      if (cancelled) return;
      const target = registryAddress.toLowerCase();

      const scheduleRelabel = (): void => {
        if (!onRelabel || relabelTimer !== null) return;
        relabelTimer = setTimeout(async () => {
          relabelTimer = null;
          try {
            const next = await fetchTopUsernames(registry);
            const ts = Date.now();
            diffUsernames(usernameBaseline, next, ts, onRelabel);
            usernameBaseline = next;
          } catch (err) {
            warnThrottled("[constellation] username refresh failed", err);
          }
        }, RELABEL_DEBOUNCE_MS);
      };

      const sub = api.event.Revive.ContractEmitted.watch().subscribe({
        next: ({ block, events }) => {
          const blockKey = String(block.number);
          const batch: NormalizedEvent[] = [];
          let sawUsername = false;
          let seq = 0;
          for (const ev of events) {
            const p = ev.payload;
            if (hexOf(p.contract).toLowerCase() !== target) continue;
            const topics = p.topics ?? [];
            if (topics.length === 0) continue;
            const name = eventNameForTopic(hexOf(topics[0]));
            if (!name) continue;
            if (USERNAME_EVENTS.has(name)) {
              sawUsername = true;
              continue;
            }
            try {
              batch.push(normalize(name, bytesOf(p.data), seq++, blockKey));
            } catch (err) {
              warnThrottled("[constellation] event decode failed", err);
            }
          }
          if (sawUsername) scheduleRelabel();
          if (batch.length === 0) return;
          const ts = Date.now();
          if (onEvent) {
            for (const le of reduceEvents(batch)) onEvent({ event: le, ts });
          }
        },
        error: (err: unknown) => warnThrottled("[constellation] subscription error", err),
      });
      unsub = () => sub.unsubscribe();

      // Seed the baseline so the first UsernameSet after subscribe can diff
      // against current chain state, not a half-known map.
      fetchTopUsernames(registry)
        .then((map) => {
          if (cancelled) return;
          usernameBaseline = map;
        })
        .catch((err) => warnThrottled("[constellation] username baseline failed", err));
    })
    .catch((err) => console.warn("[constellation] live subscribe failed", err));

  return () => {
    cancelled = true;
    if (relabelTimer !== null) clearTimeout(relabelTimer);
    unsub?.();
  };
}

export { diffUsernames };
