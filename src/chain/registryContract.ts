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
  getUsernames: Query<[string[]], string[]>;
  // Present only once the lineage contract change is deployed + cdm-installed.
  getLineageCount?: Query<[], number | bigint>;
  getLineage?: Query<[number, number], LineageEntryRaw[]>;
}
