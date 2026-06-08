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

function envList(value: string | undefined): string[] | null {
  if (!value) return null;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

/**
 * Apps whose domain starts with any of these prefixes are hidden everywhere —
 * the constellation, the event feed, the ticker, and the totals — so e2e-test
 * fixtures never show up on the live kiosk. Matched case-insensitively against
 * the domain. Override with VITE_EXCLUDE_PREFIXES (comma-separated).
 */
export const EXCLUDE_DOMAIN_PREFIXES: string[] =
  envList(import.meta.env?.VITE_EXCLUDE_PREFIXES as string | undefined) ?? ["e2e"];

/**
 * Well-known dev-signer accounts — NOT hidden, but rendered in a distinct
 * (muted) color so their apps don't look ownerless while still reading as
 * "ours, not a real builder". These are the revive H160 addresses (the form
 * the registry records as `owner`/`account`) for the standard dev keys our
 * tooling signs with:
 *   - bulletin-deploy's bare-root `DEFAULT_MNEMONIC` account, and
 *   - playground-cli's `createDevSigner` accounts (//Alice … //Ferdie),
 * all from the Substrate dev phrase ("bottom drive obey …"). Derived once via
 * `seedToAccount(DEV_PHRASE, path).ss58Address` → `ss58ToH160(...)` and
 * cross-checked against on-chain owners. Lowercased; matched case-insensitively.
 */
export const DEV_SIGNER_ACCOUNTS: string[] = [
  "0x35cdb23ff7fc86e8dccd577ca309bfea9c978d20", // bulletin-deploy root (5DfhGyQd…)
  "0x9621dde636de098b43efb0fa9b61facfe328f99d", // //Alice (5GrwvaEF…)
  "0x41dccbd49b26c50d34355ed86ff0fa9e489d1e01", // //Bob (5FHneW46…)
  "0xe2235a2ffe0354b27a6a1c543be6bf2920ff2134", // //Charlie (5FLSigC9…)
  "0xa799a942f85792ddc0028a7dd32b582e75d5e57b", // //Dave (5DAAnrj7…)
  "0x203aedc6e1ee061f55ec52309d5ac8674d4e8352", // //Eve (5HGjWAeF…)
  "0x21a8aa80a3b05b3dd74e337f9a8f5ae4a8e39f22", // //Ferdie (5CiPPseX…)
];

const DEV_ACCOUNT_SET: ReadonlySet<string> = new Set(
  DEV_SIGNER_ACCOUNTS.map((a) => a.toLowerCase()),
);

/** True if `address` is a known dev-signer account (for distinct coloring). */
export function isDevAccount(address: string | undefined): boolean {
  return address ? DEV_ACCOUNT_SET.has(address.toLowerCase()) : false;
}

/**
 * Additional builder/account addresses to hide, on top of DEV_SIGNER_ACCOUNTS —
 * for any other test accounts whose address carries no "e2e" marker. Use the
 * hex (0x…) form the registry returns; matched case-insensitively. Empty by
 * default; set VITE_EXCLUDE_ACCOUNTS (comma-separated) to add more.
 */
export const EXCLUDE_ACCOUNTS: string[] =
  envList(import.meta.env?.VITE_EXCLUDE_ACCOUNTS as string | undefined) ?? [];

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