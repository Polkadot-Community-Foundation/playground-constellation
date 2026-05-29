import type { ChainMode } from "./client.ts";
import { subscribeLive } from "./live.ts";
import { loadSnapshot } from "./reads.ts";
import type { ConstellationSource } from "./source.ts";

/**
 * Real chain source. `mode: "host"` routes through Polkadot Desktop (production);
 * `mode: "direct"` connects straight to the RPC (dev-only, for viewing real
 * data in a plain browser).
 */
export function createChainSource(mode: ChainMode): ConstellationSource {
  return {
    loadSnapshot: (onProgress) => loadSnapshot(mode, onProgress),
    subscribe: (handlers) => subscribeLive(mode, handlers),
  };
}
