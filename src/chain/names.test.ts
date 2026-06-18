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

import { describe, expect, it, vi } from "vitest";
import { ss58Decode } from "@parity/product-sdk-address";
import { bytesToHex } from "@parity/product-sdk-utils";
import { resolveNames } from "./names.ts";
import { ZERO_ROOT, type IndividualityClient } from "./peopleIdentity.ts";
import type { RegistryContract } from "./registryContract.ts";

const enc = new TextEncoder();
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const root = (n: number) => (`0x${n.toString(16).padStart(64, "0")}`) as `0x${string}`;

/** Registry stub exposing only `getRootAccounts`. `map` is addr -> root hex. */
function mockRegistry(map: Record<string, `0x${string}`>, opts: { success?: boolean } = {}) {
  const query = vi.fn(async (addrs: string[]) => {
    if (opts.success === false) return { success: false as const, value: "boom" };
    return { success: true as const, value: addrs.map((a) => map[a.toLowerCase()] ?? ZERO_ROOT) };
  });
  return { registry: { getRootAccounts: { query } } as unknown as RegistryContract, query };
}

/**
 * Individuality stub: `names` is root hex -> username. The real People-chain
 * storage keys by SS58, and `resolveUsernames` SS58-encodes before querying, so
 * the stub decodes each incoming key back to 0x-hex to look the name up — if the
 * resolver ever regressed to passing raw hex, `ss58Decode` would throw here.
 */
function mockIndividuality(names: Record<string, string>): IndividualityClient {
  return {
    query: {
      Resources: {
        Consumers: {
          getValues: async (keys: [string][]) =>
            keys.map(([ss58]) => {
              const hex = (`0x${bytesToHex(ss58Decode(ss58).publicKey)}`) as `0x${string}`;
              return names[hex] ? { full_username: enc.encode(names[hex]) } : undefined;
            }),
        },
      },
    },
  };
}

describe("resolveNames", () => {
  it("maps every address to null when there is no People-chain client", async () => {
    const { registry, query } = mockRegistry({ [addr(1)]: root(1) });
    const out = await resolveNames(registry, null, [addr(1), addr(2)]);
    expect(out).toEqual({ [addr(1)]: null, [addr(2)]: null });
    expect(query).not.toHaveBeenCalled();
  });

  it("folds address -> root -> username", async () => {
    const { registry } = mockRegistry({ [addr(1)]: root(11) });
    const ind = mockIndividuality({ [root(11)]: "alice" });
    const out = await resolveNames(registry, ind, [addr(1)]);
    expect(out[addr(1)]).toBe("alice");
  });

  it("maps a zero-root (anonymous) address to null", async () => {
    const { registry } = mockRegistry({}); // all addrs -> ZERO_ROOT
    const ind = mockIndividuality({});
    const out = await resolveNames(registry, ind, [addr(7)]);
    expect(out[addr(7)]).toBeNull();
  });

  it("chunks getRootAccounts in batches of 50", async () => {
    const map: Record<string, `0x${string}`> = {};
    const addrs: string[] = [];
    for (let i = 1; i <= 60; i++) {
      addrs.push(addr(i));
      map[addr(i)] = root(1000 + i);
    }
    const { registry, query } = mockRegistry(map);
    const names: Record<string, string> = {};
    for (let i = 1; i <= 60; i++) names[root(1000 + i)] = `u${i}`;
    const ind = mockIndividuality(names);
    const out = await resolveNames(registry, ind, addrs);
    expect(query).toHaveBeenCalledTimes(2);
    expect(out[addr(1)]).toBe("u1");
    expect(out[addr(60)]).toBe("u60");
  });

  it("returns null for addresses whose root lookup fails", async () => {
    const { registry } = mockRegistry({}, { success: false });
    const ind = mockIndividuality({ [root(11)]: "alice" });
    const out = await resolveNames(registry, ind, [addr(1)]);
    expect(out[addr(1)]).toBeNull();
  });
});
