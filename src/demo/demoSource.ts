// Scripted constellation source for the summit recording. Activate with
// ?demo=1 in the URL (see chain/select.ts). Reports itself as "live" so the
// UI doesn't show the MOCK badge — this whole src/demo/ folder is the only
// thing to delete when the real network comes back.

import type { GraphSnapshot } from "../model/graph.ts";
import type { ConstellationHandlers, ConstellationSource, LoadProgress } from "../chain/source.ts";
import { buildDemoSnapshot } from "./snapshot.ts";
import { SCRIPT } from "./script.ts";

export function createDemoSource(): ConstellationSource {
  const loadSnapshot = async (onProgress?: (p: LoadProgress) => void): Promise<GraphSnapshot> => {
    // Simulate a brief cold-load so the loading bar feels real on camera.
    const total = 6;
    for (let done = 1; done <= total; done++) {
      onProgress?.({ done, total, label: "loading constellation" });
      await new Promise((r) => setTimeout(r, 140));
    }
    return buildDemoSnapshot();
  };

  const subscribe = (handlers: ConstellationHandlers): (() => void) => {
    const { onEvent } = handlers;
    if (!onEvent) return () => {};
    let cancelled = false;
    let index = 0;
    let block = 8_400_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      const step = SCRIPT[index % SCRIPT.length];
      index += 1;
      block += 1 + Math.floor(Math.random() * 3);
      const event = step.build(String(block));
      onEvent({ event, ts: Date.now() });

      const nextStep = SCRIPT[index % SCRIPT.length];
      timeoutId = setTimeout(tick, nextStep.delay);
    };

    timeoutId = setTimeout(tick, SCRIPT[0].delay);

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  };

  return { loadSnapshot, subscribe };
}
