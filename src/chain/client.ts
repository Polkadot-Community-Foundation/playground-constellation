import { getChainAPI } from "@parity/product-sdk-chain-client";
import { ContractManager, createContractRuntimeFromClient, type CdmJson } from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { seedToAccount } from "@parity/product-sdk-keys";
import { createClient, type PolkadotClient, type TypedApi } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import cdmJson from "../../cdm.json" with { type: "json" };
import { ASSET_HUB_WS, CHAIN, REGISTRY_PACKAGE } from "../config.ts";
import type { QueryResult, RegistryContract } from "./registryContract.ts";

export type ChainMode = "host" | "direct";
type AssetHubApi = TypedApi<typeof paseo_asset_hub>;

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
    api = raw.getTypedApi(paseo_asset_hub);
  }
  const runtime = createContractRuntimeFromClient(raw, paseo_asset_hub);
  const manager = new ContractManager(cdmJson as unknown as CdmJson, runtime, {
    defaultOrigin: readOrigin(),
  });
  const registry = manager.getContract(REGISTRY_PACKAGE) as unknown as RegistryContract;
  const registryAddress = manager.getAddress(REGISTRY_PACKAGE) as string;
  return { api, registry, registryAddress };
}

/** Connect (host or direct) and build the typed registry handle. Cached per mode. */
export function getChainHandle(mode: ChainMode): Promise<ChainHandle> {
  let h = handles.get(mode);
  if (!h) {
    h = build(mode);
    handles.set(mode, h);
  }
  return h;
}

export type { QueryResult };
