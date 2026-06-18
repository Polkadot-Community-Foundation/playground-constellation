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
 * People/Individuality-chain username resolution. Registry v17 binds an H160 to
 * a DotNS *root* AccountId32 (`getRootAccounts`); the human-readable name is
 * NOT stored in the contract — it lives on the People chain under
 * `Resources.Consumers`, keyed by that root pubkey. Ported from
 * playground-app's `utils/peopleIdentity.ts`.
 */

import { ss58Encode } from "@parity/product-sdk-address";
import { hexToBytes } from "@parity/product-sdk-utils";

/** 32-byte zero AccountId = "no binding / anonymous". */
export const ZERO_ROOT = ("0x" + "00".repeat(32)) as `0x${string}`;

/**
 * Decoded value of `Resources.Consumers` on the People/Individuality chain
 * (paseo_individuality). The usernames are raw UTF-8 byte arrays, NOT decoded
 * strings: `full_username` is optional, `lite_username` may be empty. Only the
 * two fields we read are modelled; a wide structural type keeps the resolver
 * unit-testable with a mock and decoupled from the generated descriptor.
 */
type ConsumerInfo = {
  full_username?: Uint8Array | null;
  lite_username?: Uint8Array | null;
};

/** Structural slice of the host-routed individuality client we depend on. */
export type IndividualityClient = {
  query: {
    Resources: {
      Consumers: {
        getValues: (keys: [string][]) => Promise<(ConsumerInfo | undefined)[]>;
      };
    };
  };
};

const decoder = new TextDecoder();

/** Decode a username byte array to a non-empty string, or null. */
function decodeName(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length === 0) return null;
  const name = decoder.decode(bytes);
  return name.length > 0 ? name : null;
}

/**
 * Prefer the full DotNS username, else the lite username, else null.
 * Both are raw UTF-8 byte arrays on chain (see `ConsumerInfo`).
 */
function pickName(info: ConsumerInfo | undefined): string | null {
  if (!info) return null;
  return decodeName(info.full_username) ?? decodeName(info.lite_username);
}

/**
 * Resolve a batch of root AccountId32s to People-chain usernames in ONE host
 * storage round-trip. Zero roots are anonymous and never queried. Returns a
 * Map keyed by the input root hex (zero root -> null, bound-but-no-name -> null).
 */
export async function resolveUsernames(
  client: IndividualityClient,
  roots: ReadonlyArray<`0x${string}`>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const bound = roots.filter((r) => r !== ZERO_ROOT);
  for (const r of roots) if (r === ZERO_ROOT) out.set(r, null);
  if (bound.length === 0) return out;
  // `Resources.Consumers` keys by SS58String, but the contract hands us 0x-hex
  // AccountId32 roots. SS58-encode each before querying (the storage key hashes
  // the decoded 32 bytes, so the prefix is immaterial). Results stay index-
  // aligned, so we map them back onto the original hex roots. Mirrors
  // playground-app's `ss58ResolverAdapter`.
  const values = await client.query.Resources.Consumers.getValues(
    bound.map((r) => [ss58Encode(hexToBytes(r.slice(2)))] as [string]),
  );
  bound.forEach((r, i) => out.set(r, pickName(values[i])));
  return out;
}
