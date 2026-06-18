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

// Local typing for the registry reads we use. The SDK's generated ABI
// augmentations are inert in this repo (CDM codegen targets a different
// package name), so contract calls fall back to the untyped Contract. We
// describe the exact read surface here to keep call sites type-safe.

export type QueryResult<T> = { success: true; value: T } | { success: false; value: unknown };

interface Query<Args extends unknown[], T> {
  query(...args: Args): Promise<QueryResult<T>>;
}

export interface AppEntryRaw {
  index: number;
  domain: string;
  metadata_uri: string;
  owner: string;
  visibility: number;
  publisher: string;
}

export interface AppsPageRaw {
  total: number;
  scanned: number;
  entries: AppEntryRaw[];
}

export interface TopBuilderRaw {
  account: string;
  score: bigint;
}

export interface LineageEntryRaw {
  child: string;
  source: string;
}

export interface RegistryContract {
  getApps: Query<[number, number], AppsPageRaw>;
  getStarCount: Query<[string], number | bigint>;
  getModCount: Query<[string], number | bigint>;
  getPinnedApps: Query<[], AppEntryRaw[]>;
  getTopBuilders: Query<[number, number], TopBuilderRaw[]>;
  // v17 identity model: maps each address to its bound DotNS root pubkey
  // (bytes32 hex; zero root = anonymous/unbound). Display names are resolved
  // off-chain from the root via the People chain (see peopleIdentity.ts).
  getRootAccounts: Query<[string[]], string[]>;
  // Present only once the lineage contract change is deployed + cdm-installed.
  getLineageCount?: Query<[], number | bigint>;
  getLineage?: Query<[number, number], LineageEntryRaw[]>;
}