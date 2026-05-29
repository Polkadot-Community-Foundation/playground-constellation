/** Chain preset passed to getChainAPI (host-routed). */
export const CHAIN = "paseo" as const;

/**
 * Asset Hub WS endpoint for the DEV-ONLY direct-RPC mode (VITE_USE_DIRECT=1),
 * used to view real data in a plain browser outside the host. The production
 * path inside Polkadot Desktop never uses this — it routes through the host.
 */
export const ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";

/**
 * Max nodes kept in the live graph. Bounds memory, the localStorage cache,
 * and per-frame render cost on a kiosk that runs for days. Oldest non-pinned
 * nodes are evicted past this; pinned roots are always kept.
 */
export const MAX_NODES = 600;

/** Registry package; override for staging via VITE_PLAYGROUND_REGISTRY_PACKAGE. */
export const REGISTRY_PACKAGE =
  (import.meta.env?.VITE_PLAYGROUND_REGISTRY_PACKAGE as string | undefined) ||
  "@w3s/playground-registry";

/**
 * Contract-actual XP award amounts (from registry/lib.rs):
 *   deploy/launch = 2, +1 if moddable; mod credit = 1; star = 1.
 * These are the real on-chain deltas shown on screen.
 */
export const XP_BASE = {
  deploy: 2,
  moddableBonus: 1,
  mod: 1,
  star: 1,
} as const;

/**
 * Display multipliers applied on top of the contract-actual base values.
 * Default 1 (show real numbers). Tune here to amplify the on-screen XP
 * without changing the chain.
 */
export const XP_MULTIPLIER = {
  deploy: 1,
  mod: 1,
  star: 1,
} as const;
