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

import { beforeEach, describe, expect, it, vi } from "vitest";

const fromLiveClient =
  vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue({
    getContract: () => ({}),
    getAddress: () => "0x" + "1".repeat(40),
  });

// A host client exposes raw/typed Asset Hub APIs plus the People-chain client.
const hostClient = {
  raw: { assetHub: {} },
  assetHub: {},
  individuality: {},
};
const getChainAPI = vi.fn<(...args: unknown[]) => unknown>().mockResolvedValue(hostClient);

// Stub the whole chain stack so build() never opens a socket. `host` mode goes
// through getChainAPI; `direct` mode through createClient → getTypedApi. Both
// funnel into the single ContractManager.fromLiveClient call we assert on.
vi.mock("@parity/product-sdk-chain-client", () => ({
  getChainAPI: (...args: unknown[]) => getChainAPI(...args),
}));
vi.mock("polkadot-api", () => ({
  createClient: () => ({ getTypedApi: () => ({}) }),
}));
vi.mock("polkadot-api/ws", () => ({ getWsProvider: () => ({}) }));
vi.mock("@parity/product-sdk-descriptors/summit-asset-hub", () => ({
  summit_asset_hub: {},
}));
vi.mock("@parity/product-sdk-address", () => ({ ss58Encode: () => "5Origin" }));
vi.mock("@parity/product-sdk-contracts", () => ({
  ContractManager: { fromLiveClient: (...args: unknown[]) => fromLiveClient(...args) },
}));

import { REGISTRY_META_ADDRESS } from "../config.ts";
import { getChainHandle } from "./client.ts";

const PASEO_META_REGISTRY = "0xf62c2ece29cd8df2e10040ecfa5a894a5c5d9cb0";
const SUMMIT_META_REGISTRY = "0xa5747e60ae27f93e92019e4021abfc4957050141";

/** The registryAddress passed in the most recent fromLiveClient call. */
function lastRegistryAddress(): string | undefined {
  const calls = fromLiveClient.mock.calls;
  const opts = calls[calls.length - 1]?.[3] as { registryAddress?: string };
  return opts?.registryAddress;
}

describe("getChainHandle registry resolution", () => {
  beforeEach(() => {
    fromLiveClient.mockClear();
  });

  // Both modes must inject the address explicitly — relying on cdm.json.registry
  // resolves the PASEO meta-registry on the summit chain, so no apps are found.
  // getChainHandle caches per mode, so each mode triggers exactly one build().
  it.each(["direct", "host"] as const)(
    "%s mode resolves via the summit meta-registry, not cdm.json's baked (paseo) value",
    async (mode) => {
      await getChainHandle(mode);

      expect(fromLiveClient).toHaveBeenCalledTimes(1);
      expect(lastRegistryAddress()).toBe(REGISTRY_META_ADDRESS);
      expect(lastRegistryAddress()).toBe(SUMMIT_META_REGISTRY);
      expect(lastRegistryAddress()).not.toBe(PASEO_META_REGISTRY);
    },
  );
});
