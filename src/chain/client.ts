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

import { getChainAPI } from "@parity/product-sdk-chain-client";
import { ContractManager, type CdmJson } from "@parity/product-sdk-contracts";
import { summit_asset_hub } from "@parity/product-sdk-descriptors/summit-asset-hub";
import { seedToAccount } from "@parity/product-sdk-keys";
import { createClient, type PolkadotClient, type TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import cdmJson from "../../cdm.json" with { type: "json" };
import { ASSET_HUB_WS, CHAIN, REGISTRY_PACKAGE } from "../config.ts";
import type { QueryResult, RegistryContract } from "./registryContract.ts";

export type ChainMode = "host" | "direct";
type AssetHubApi = TypedApi<typeof summit_asset_hub>;

export interface ChainHandle {
  api: AssetHubApi;
  registry: RegistryContract;
  registryAddress: string;
}

const handles = new Map<ChainMode, Promise<ChainHandle>>();

// Team deploy SURI — mapped on Paseo Next, used as the read origin so dry-run
// calls don't fail with Revive::AccountUnmapped. Same mnemonic that lives in
// playground-app/scripts/check-migration.ts; not secret, used here only to
// supply an SS58 to the dispatcher — never to sign.
const TEAM_SURI = "ensure coffee ripple degree senior grunt unit seek defense year spoon fix";

/** Read origin for queries: team SURI's SS58 (matches playground-app scripts). */
function readOrigin(): string {
  return seedToAccount(TEAM_SURI, "").ss58Address;
}

async function build(mode: ChainMode): Promise<ChainHandle> {
  let raw: PolkadotClient;
  let api: AssetHubApi;
  if (mode === "host") {
    // Production: route through the Polkadot host container.
    const client = await getChainAPI(CHAIN);
    raw = client.raw.assetHub;
    api = client.assetHub;
  } else {
    // Dev-only: connect directly to the RPC to view real data in a browser.
    raw = createClient(getWsProvider(ASSET_HUB_WS));
    api = raw.getTypedApi(summit_asset_hub);
  }
  // Resolve the registry address LIVE from the on-chain CDM meta-registry
  // (cdm.json.registry) rather than trusting the pinned snapshot address. The
  // snapshot still supplies the ABI; only the address is resolved fresh, so the
  // kiosk always reads the latest deployed registry even when cdm.json is stale.
  // Mirrors playground-cli's registry access. Read-only here, so no signer is
  // wired in. fromLiveClient performs a getAddress dry-run against the meta-
  // registry; if that fails we throw rather than silently fall back to the
  // (possibly stale) snapshot address.
  let manager: ContractManager;
  try {
    manager = await ContractManager.fromLiveClient(cdmJson as unknown as CdmJson, raw, summit_asset_hub, {
      libraries: [REGISTRY_PACKAGE],
      defaultOrigin: readOrigin(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `MetaRegistryFailure: could not resolve the live ${REGISTRY_PACKAGE} address from the CDM meta-registry. Refusing the cdm.json snapshot because it may be stale. ${msg}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
  const registry = manager.getContract(REGISTRY_PACKAGE) as unknown as RegistryContract;
  const registryAddress = manager.getAddress(REGISTRY_PACKAGE) as string;
  // Diagnostic: which contract are we actually reading from? The live address is
  // the source of truth (uniquely identifies the deployment); the cdm.json
  // `version` is only the bundled ABI snapshot and may lag the live deployment.
  const snapshot = (cdmJson as { registry?: string; contracts?: Record<string, { version?: number; address?: string }> });
  const pinned = snapshot.contracts?.[REGISTRY_PACKAGE];
  console.info(
    `[constellation] reading ${REGISTRY_PACKAGE} (mode=${mode}) → live address ${registryAddress}`,
    `| cdm.json snapshot: v${pinned?.version} @ ${pinned?.address}`,
    `| meta-registry ${snapshot.registry}`,
    registryAddress.toLowerCase() === pinned?.address?.toLowerCase()
      ? "(live matches snapshot)"
      : "(live DIFFERS from snapshot — snapshot is stale)",
  );
  return { api, registry, registryAddress };
}

/** Connect (host or direct) and build the typed registry handle. Cached per mode. */
export function getChainHandle(mode: ChainMode): Promise<ChainHandle> {
  let h = handles.get(mode);
  if (!h) {
    // Don't cache a rejected handle. `build` can now fail at the live
    // meta-registry resolution (fromLiveClient), and a transient hiccup there
    // would otherwise poison this cache forever — every later consumer
    // (loadSnapshot, subscribe, highlights, getRegistryAddress) would await the
    // same permanently-rejected promise with no way to retry. Drop it on failure
    // so the next call rebuilds and the kiosk can recover on its own.
    h = build(mode).catch((err) => {
      handles.delete(mode);
      throw err;
    });
    handles.set(mode, h);
  }
  return h;
}

export type { QueryResult };