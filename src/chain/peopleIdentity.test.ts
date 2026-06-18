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
import { hexToBytes } from "@parity/product-sdk-utils";
import { resolveUsernames, ZERO_ROOT } from "./peopleIdentity.ts";

const enc = new TextEncoder();
const root = (n: number) => (`0x${n.toString(16).padStart(64, "0")}`) as `0x${string}`;

function mockClient(values: Array<{ full_username?: Uint8Array | null; lite_username?: Uint8Array | null } | undefined>) {
  const getValues = vi.fn(async (_keys: [string][]) => values);
  return {
    getValues,
    client: { query: { Resources: { Consumers: { getValues } } } },
  };
}

describe("resolveUsernames", () => {
  it("prefers the full username over the lite username", async () => {
    const { client } = mockClient([{ full_username: enc.encode("alice"), lite_username: enc.encode("a") }]);
    const out = await resolveUsernames(client, [root(1)]);
    expect(out.get(root(1))).toBe("alice");
  });

  it("falls back to the lite username when full is absent", async () => {
    const { client } = mockClient([{ full_username: null, lite_username: enc.encode("bob") }]);
    const out = await resolveUsernames(client, [root(2)]);
    expect(out.get(root(2))).toBe("bob");
  });

  it("maps empty / undefined info to null", async () => {
    const { client } = mockClient([{ full_username: new Uint8Array(), lite_username: new Uint8Array() }, undefined]);
    const out = await resolveUsernames(client, [root(3), root(4)]);
    expect(out.get(root(3))).toBeNull();
    expect(out.get(root(4))).toBeNull();
  });

  it("maps the zero root to null and never queries it", async () => {
    const { client, getValues } = mockClient([{ full_username: enc.encode("carol") }]);
    const out = await resolveUsernames(client, [ZERO_ROOT, root(5)]);
    expect(out.get(ZERO_ROOT)).toBeNull();
    expect(out.get(root(5))).toBe("carol");
    // Only the one bound root is queried.
    expect(getValues).toHaveBeenCalledTimes(1);
    expect((getValues.mock.calls[0][0] as [string][]).length).toBe(1);
  });

  it("queries Resources.Consumers with SS58-encoded keys, NOT raw 0x-hex", async () => {
    // The live People-chain storage keys by SS58String; the contract returns
    // 0x-hex AccountId32. The resolver must SS58-encode before querying, else
    // every key misses and all names resolve to null.
    const { client, getValues } = mockClient([{ full_username: enc.encode("dave") }]);
    await resolveUsernames(client, [root(9)]);
    const key = (getValues.mock.calls[0][0] as [string][])[0][0];
    expect(key).not.toMatch(/^0x/); // not raw hex
    // Round-trips back to the original 32-byte root pubkey.
    expect([...ss58Decode(key).publicKey]).toEqual([...hexToBytes(root(9).slice(2))]);
  });

  it("returns an empty map without querying when all roots are zero", async () => {
    const { client, getValues } = mockClient([]);
    const out = await resolveUsernames(client, [ZERO_ROOT]);
    expect(out.get(ZERO_ROOT)).toBeNull();
    expect(getValues).not.toHaveBeenCalled();
  });
});
