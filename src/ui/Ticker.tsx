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

// Bottom ticker: a slow, large-type marquee across the lower third. Live
// on-chain events scroll through with priority; during quiet stretches the
// rotation falls back to polled highlights so the strip never goes empty.
// Ported from playground-app's event-stream ticker (rAF + translate3d slot
// recycling), slowed down and scaled up for big-screen legibility.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  createReplayCursor,
  isHighlight,
  mixedReplayItems,
  nextTickerItem,
  type ReplayCursor,
  type TickerItem,
} from "../model/ticker.ts";

// Bigger type than playground-app (12px → ~40px), so it scrolls much slower.
const SPEED_PX_PER_SECOND = 30;
const INITIAL_ITEM_COUNT = 8;
const PENDING_QUEUE_LIMIT = 80;

interface Slot {
  slotId: string;
  item: TickerItem;
}

export function Ticker({ pool }: { pool: readonly TickerItem[] }) {
  const { slots, advance } = useTickerSlots(pool);
  const { windowRef, trackRef, rowRef } = useTickerMarquee(slots, advance);

  if (slots.length === 0) return null;

  return (
    <div className="ticker" aria-label="Live playground activity">
      <div className="ticker-lede">
        <span className="ticker-pulse" />
        LIVE
      </div>
      <div className="ticker-window" ref={windowRef}>
        <div className="ticker-track" ref={trackRef}>
          <div className="ticker-row" ref={rowRef}>
            {slots.map((slot) => (
              <span key={slot.slotId} className="ticker-item" data-tone={slot.item.tone}>
                <span className="ticker-sep" aria-hidden="true">
                  ✦
                </span>
                <span className="ticker-text">{slot.item.text}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function useTickerSlots(pool: readonly TickerItem[]) {
  const knownIdsRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<TickerItem[]>([]);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const replayCursorRef = useRef<ReplayCursor>(createReplayCursor());
  const poolRef = useRef<readonly TickerItem[]>([]);
  const slotsRef = useRef<readonly Slot[]>([]);
  const slotCounterRef = useRef(0);
  const [slots, setSlots] = useState<readonly Slot[]>([]);

  const createSlot = useCallback((item: TickerItem): Slot => {
    slotCounterRef.current += 1;
    return { slotId: `${item.id}:${slotCounterRef.current}`, item };
  }, []);

  useEffect(() => {
    poolRef.current = pool;
    if (pool.length === 0) return;

    // Bound the "seen" set to the live pool (+ any in-flight pending item) so
    // it can't grow without limit over a multi-day kiosk run — live ids are
    // monotonic and unique, and the pool upstream is already capped.
    const poolIds = new Set(pool.map((i) => i.id));
    for (const id of knownIdsRef.current) {
      if (!poolIds.has(id) && !pendingIdsRef.current.has(id)) knownIdsRef.current.delete(id);
    }

    // First non-empty pool: seed the visible track from the rotation.
    if (slotsRef.current.length === 0) {
      for (const item of pool) knownIdsRef.current.add(item.id);
      const cursor = createReplayCursor();
      const initial = mixedReplayItems(pool, INITIAL_ITEM_COUNT, cursor).map(createSlot);
      replayCursorRef.current = cursor;
      slotsRef.current = initial;
      setSlots(initial);
      return;
    }

    // New items since last pool: live ones jump the queue (priority); the rest
    // just become eligible for idle rotation.
    const fresh = pool.filter((item) => !knownIdsRef.current.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) knownIdsRef.current.add(item.id);

    const freshLive = fresh.filter((item) => !isHighlight(item));
    pendingRef.current.push(...freshLive);
    for (const item of freshLive) pendingIdsRef.current.add(item.id);
    if (pendingRef.current.length > PENDING_QUEUE_LIMIT) {
      const dropped = pendingRef.current.splice(0, pendingRef.current.length - PENDING_QUEUE_LIMIT);
      for (const item of dropped) pendingIdsRef.current.delete(item.id);
    }
  }, [createSlot, pool]);

  const nextItem = useCallback((): TickerItem | null => {
    const item = nextTickerItem(
      pendingRef.current,
      pendingIdsRef.current,
      poolRef.current,
      replayCursorRef.current,
    );
    // Last resort if the pool is momentarily empty: reuse the leading slot.
    return item ?? slotsRef.current[0]?.item ?? null;
  }, []);

  const advance = useCallback((): boolean => {
    const item = nextItem();
    if (!item) return false;
    const current = slotsRef.current;
    const next = current.length === 0 ? [createSlot(item)] : [...current.slice(1), createSlot(item)];
    slotsRef.current = next;
    setSlots(next);
    return true;
  }, [createSlot, nextItem]);

  return { slots, advance };
}

function useTickerMarquee(slots: readonly Slot[], advance: () => boolean) {
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const advanceByRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useLayoutEffect(() => {
    advanceByRef.current = measureFirstItemAdvance(rowRef.current);
  }, [slots]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      advanceByRef.current = measureFirstItemAdvance(row);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frameId = 0;
    const tick = (time: number) => {
      const lastFrame = lastFrameRef.current ?? time;
      lastFrameRef.current = time;

      const elapsedMs = Math.min(time - lastFrame, 100);
      offsetRef.current += (elapsedMs / 1_000) * SPEED_PX_PER_SECOND;

      const advanceBy = advanceByRef.current;
      if (advanceBy > 0) {
        while (offsetRef.current >= advanceBy) {
          offsetRef.current -= advanceBy;
          let advanced = false;
          flushSync(() => {
            advanced = advanceRef.current();
          });
          if (!advanced) break;
        }
      }
      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-offsetRef.current}px, 0, 0)`;
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return { windowRef, trackRef, rowRef };
}

/** Distance from the first item to the second (or its own width + gap). */
function measureFirstItemAdvance(row: HTMLDivElement | null): number {
  if (!row) return 0;
  const first = row.querySelector<HTMLElement>(".ticker-item");
  if (!first) return 0;
  const second = first.nextElementSibling as HTMLElement | null;
  if (second) {
    return second.getBoundingClientRect().left - first.getBoundingClientRect().left;
  }
  const gap = Number.parseFloat(window.getComputedStyle(row).columnGap) || 0;
  return first.getBoundingClientRect().width + gap;
}
