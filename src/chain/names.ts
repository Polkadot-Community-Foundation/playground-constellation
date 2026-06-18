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

/**
 * Display-name resolution for registry v17. Maps a batch of H160 addresses to
 * DotNS usernames in two hops: `getRootAccounts` (Asset Hub) -> root pubkeys,
 * then `resolveUsernames` (People chain) -> names. The single source of truth
 * for `reads.ts`, `highlights.ts`, and `live.ts`.
 *
 * Never throws: a missing People-chain client, a failed root lookup, or a
 * People-chain hiccup all degrade an address to `null`, which callers render
 * as a short address.
 */

import { resolveUsernames, ZERO_ROOT, type IndividualityClient } from "./peopleIdentity.ts";
import type { RegistryContract } from "./registryContract.ts";

/** Chunk size for `getRootAccounts` so a large address set can't exceed a query/gas cap. */
const ROOT_PAGE = 50;

/**
 * Resolve display names for `addresses`. Returns a record keyed by LOWERCASED
 * address; every input address is present, mapped to its username or `null`
 * (anonymous, unresolved, or no People-chain client).
 */
export async function resolveNames(
  registry: RegistryContract,
  individuality: IndividualityClient | null,
  addresses: ReadonlyArray<string>,
): Promise<Record<string, string | null>> {
  const addrs = addresses.map((a) => a.toLowerCase());
  const out: Record<string, string | null> = {};
  for (const a of addrs) out[a] = null;
  if (!individuality || addrs.length === 0) return out;

  // address -> bound root pubkey (lowercased; ZERO_ROOT = anonymous/unbound).
  const rootByAddr = new Map<string, `0x${string}`>();
  for (let i = 0; i < addrs.length; i += ROOT_PAGE) {
    const chunk = addrs.slice(i, i + ROOT_PAGE);
    let res: Awaited<ReturnType<RegistryContract["getRootAccounts"]["query"]>>;
    try {
      res = await registry.getRootAccounts.query(chunk as `0x${string}`[]);
    } catch {
      continue; // leave this chunk's addresses at null
    }
    if (!res.success) continue;
    chunk.forEach((a, j) => {
      const r = (res.success ? res.value[j] : undefined) ?? ZERO_ROOT;
      rootByAddr.set(a, r.toLowerCase() as `0x${string}`);
    });
  }

  const uniqueRoots = [...new Set([...rootByAddr.values()])].filter((r) => r !== ZERO_ROOT);
  if (uniqueRoots.length === 0) return out;

  let nameByRoot: Map<string, string | null>;
  try {
    nameByRoot = await resolveUsernames(individuality, uniqueRoots);
  } catch {
    return out;
  }

  for (const [a, r] of rootByAddr) {
    if (r === ZERO_ROOT) continue;
    out[a] = nameByRoot.get(r) ?? null;
  }
  return out;
}
