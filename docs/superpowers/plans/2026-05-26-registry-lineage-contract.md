# Registry Mod-Lineage Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist mod-lineage (which app was modded from which source) on-chain in the `@w3s/playground-registry` contract, and expose it via a paged read method, so a read-only display app can cold-load the complete mod family tree with ordinary host-compatible contract reads.

**Architecture:** Today the source→child mod link is never stored — it only travels transiently in the `ModPointAwarded` event payload (registry comment: *"no persisted modded_from link"*). The display app runs inside the Polkadot host container, which permits only live `chainHead`/`chainSpec`/`transaction` JSON-RPC — no `archive_*`, so it cannot scan historical events. The fix is a small, **additive, backward-compatible** change to the registry: when a genuinely-new app is published with a non-empty `modded_from` whose source exists, append a `LineageEdge { child, source }` to an append-only on-chain list, and add `get_lineage_count()` + `get_lineage(start, count)` getters. No existing storage field, method, event, or struct is modified, so `playground-app` and `playground-cli` are unaffected.

**Tech Stack:** Rust `#![no_std]` PVM contract (`cargo-pvm-contract`), built with `cdm build` via `pnpm build:contracts`. Nightly toolchain (pinned in `rust-toolchain.toml`). On-chain verification via `pnpm tsx` scripts using `@parity/product-sdk-contracts` against the `@staging/playground-registry` deployment.

**Single file to change for the contract:** `/Users/utkarsh/Desktop/Projects/Playground/playground-app/contracts/registry/lib.rs`

---

## Context the implementing agent needs

- **Storage layout is name-keyed, not positional.** `#[pvm::storage]` derives each field's storage key from `keccak256` of the field identifier, so **adding** fields cannot corrupt existing data. This change is safe to deploy over the existing contract bytecode (a redeploy gets a new address anyway; the Summit uses a fresh deploy).
- **`modded_from` is a plain `String`; `""` means "no source."** (An `Option<String>` was deliberately avoided — it corrupts later params under viem's tuple encoding; see the comment at `lib.rs:609-615`.)
- **Lineage must be recorded independently of XP gating.** The existing award path is gated by `is_dev_signer`, the blacklist, and a per-`(caller, source)` dedupe. The *visual* tree must be complete, so lineage recording is placed **before** that gating and depends only on: this is a new app, `modded_from` is non-empty, and the source exists.
- **Build requires nightly Rust** (auto-selected via `rust-toolchain.toml`). `pnpm build:contracts` runs `cdm build`.
- **Two existing patterns to mirror exactly:** the `AppEntry` SolAbi return struct (`lib.rs:51-59`) and the `get_apps` paged getter (`lib.rs:1110-1147`).
- **`@staging` deploy needs the team dev SURI.** The smoke-test file already contains it (`scripts/smoke-test-points.ts:58`: `DEV_SURI = "ensure coffee ripple degree senior grunt unit seek defense year spoon fix"`). Deploying is an ops step with a known storage-deposit caveat (see Task 4) — flag to the user if blocked.

---

## File Structure

All edits are in two files of the `playground-app` repo:

- **Modify:** `contracts/registry/lib.rs` — add two structs, three storage fields, one recording block in `publish`, two getter methods.
- **Create:** `scripts/check-lineage.ts` — standalone on-chain verification script (publish source + child, read back the edge).

No new crates, no Cargo.toml changes (uses existing `parity_scale_codec`, `alloc::vec::Vec`, `alloc::string::String`, `pvm::SolAbi`).

---

## Task 1: Add the lineage data structures

**Files:**
- Modify: `/Users/utkarsh/Desktop/Projects/Playground/playground-app/contracts/registry/lib.rs`

- [ ] **Step 1: Add the SCALE storage-edge struct next to `AppInfo`.**

Find `AppInfo` (ends at `lib.rs:49`). Immediately **after** the closing `}` of `AppInfo` (line 49) and **before** `#[derive(pvm::SolAbi)] pub struct AppEntry` (line 51), insert:

```rust
/// One mod-lineage edge, stored SCALE-encoded in the append-only
/// `lineage_at` list. `child` was published as a mod of `source`.
/// Recorded once per child on its first publish (see `publish`).
#[derive(Default, Clone, Encode, Decode)]
pub struct LineageEdge {
    pub child: String,
    pub source: String,
}
```

- [ ] **Step 2: Add the SolAbi return struct next to `AppsPage`.**

Find `AppsPage` (ends at `lib.rs:80`). Immediately **after** its closing `}` (line 80), insert:

```rust
/// ABI-encoded return row for `get_lineage`. Mirrors `LineageEdge` but
/// derives `SolAbi` for the external read ABI (storage uses SCALE).
#[derive(pvm::SolAbi)]
pub struct LineageEntry {
    pub child: String,
    pub source: String,
}
```

- [ ] **Step 3: Build to confirm the structs compile.**

Run: `cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && pnpm build:contracts`
Expected: PASS — `cdm build` completes and writes `target/playground-registry.release.polkavm` + `target/playground-registry.release.abi.json`. (At this point the new structs are unused; Rust may warn about `LineageEntry`/`LineageEdge` being unused — warnings are fine, errors are not.)

---

## Task 2: Add the lineage storage fields

**Files:**
- Modify: `/Users/utkarsh/Desktop/Projects/Playground/playground-app/contracts/registry/lib.rs`

- [ ] **Step 1: Add three fields to the `Storage` struct.**

The `Storage` struct's `usernames` / `username_to_owner` block is the last group, ending with `username_to_owner: Mapping<String, Address>,` at `lib.rs:544`, then the struct closes with `}` at `lib.rs:545`. Insert the following **after** line 544 and **before** the closing `}` (line 545):

```rust
    // --- Mod lineage (constellation display) ---
    /// Number of recorded lineage edges. Index space for `lineage_at`.
    lineage_count: u32,
    /// Append-only list of mod edges, `index -> LineageEdge { child, source }`.
    /// Written once per child in `publish`; never mutated or removed.
    lineage_at: Mapping<u32, LineageEdge>,
    /// `child domain -> already recorded?`. Guards against a duplicate edge
    /// if a child domain is ever published-as-new more than once (e.g.
    /// publish → unpublish → publish, where `info` was removed).
    lineage_recorded: Mapping<String, bool>,
```

- [ ] **Step 2: Build to confirm the storage fields compile.**

Run: `cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && pnpm build:contracts`
Expected: PASS. (`lineage_*` storage accessors now exist; still unused until Task 3 — warnings OK, no errors.)

---

## Task 3: Record lineage in `publish` and add the getters

**Files:**
- Modify: `/Users/utkarsh/Desktop/Projects/Playground/playground-app/contracts/registry/lib.rs`

- [ ] **Step 1: Insert the lineage-recording block in `publish`.**

In `publish`, locate the early-return guard that ends the re-publish path (`lib.rs:668-670`):

```rust
        if !is_new_app {
            return;
        }
```

Immediately **after** that block's closing `}` (line 670) and **before** the comment that begins `// Block reward re-issuance for any domain...` (line 672), insert:

```rust

        // --- Mod lineage (constellation display) ---
        // Record the source→child edge exactly once, for any genuinely-new
        // app that declares a non-empty `modded_from` whose source exists.
        // This is deliberately INDEPENDENT of the XP award / dedupe /
        // dev-signer gating below, so the visual family tree is complete
        // (it includes dev-mode publishes and cross-owner self-mods).
        // Re-publishes never reach here (the `is_new_app` guard above
        // returned early); `lineage_recorded` guards any future re-entry.
        if !modded_from.is_empty()
            && Storage::info().contains(&modded_from)
            && !Storage::lineage_recorded().get(&domain).unwrap_or(false)
        {
            let idx = Storage::lineage_count().get().unwrap_or(0);
            Storage::lineage_at().insert(&idx, &LineageEdge {
                child: domain.clone(),
                source: modded_from.clone(),
            });
            Storage::lineage_count().set(&(idx.saturating_add(1)));
            Storage::lineage_recorded().insert(&domain, &true);
        }
```

> Note on borrows: this block only borrows/clones `modded_from` and `domain`. Both remain owned for the existing award code that follows (`modded_from` is moved later at the `let src = modded_from;` line; `domain` is moved later into the `ModPointEvent`). Do not reorder it after those moves.

- [ ] **Step 2: Add the two getter methods.**

Find the end of `get_apps` — its `AppsPage { total, scanned, entries }` return and the method's closing `}` at `lib.rs:1147`, followed by the `// --- Domain data queries ---` comment at line 1149. Insert the following **between** line 1147 (`get_apps`'s closing `}`) and the `// --- Domain data queries ---` comment:

```rust

    // --- Mod-lineage queries (constellation display) ---

    /// Total number of recorded mod-lineage edges.
    #[pvm::method]
    pub fn get_lineage_count() -> u32 {
        Storage::lineage_count().get().unwrap_or(0)
    }

    /// Return a page of mod-lineage edges starting at `start`, up to `count`
    /// entries, in insertion (oldest-first) order. Each entry is
    /// `{ child, source }`: `child` was published as a mod of `source`.
    /// Page over the full set with `get_lineage_count()`.
    #[pvm::method]
    pub fn get_lineage(start: u32, count: u32) -> Vec<LineageEntry> {
        let total = Storage::lineage_count().get().unwrap_or(0);
        let mut entries: Vec<LineageEntry> = Vec::new();
        if count == 0 || start >= total {
            return entries;
        }
        let mut idx = start;
        while idx < total && (entries.len() as u32) < count {
            if let Some(edge) = Storage::lineage_at().get(&idx) {
                entries.push(LineageEntry {
                    child: edge.child,
                    source: edge.source,
                });
            }
            idx += 1;
        }
        entries
    }
```

- [ ] **Step 3: Build to confirm everything compiles with no warnings about unused items.**

Run: `cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && pnpm build:contracts`
Expected: PASS — clean build. `LineageEdge`, `LineageEntry`, and all three storage fields are now used. Confirm `target/playground-registry.release.abi.json` now contains `getLineage` and `getLineageCount` (Rust `snake_case` → Solidity `camelCase`):

Run: `grep -oE '"name":"(getLineage|getLineageCount)"' /Users/utkarsh/Desktop/Projects/Playground/playground-app/target/playground-registry.release.abi.json`
Expected: both `"name":"getLineage"` and `"name":"getLineageCount"` appear.

- [ ] **Step 4: Confirm no existing method/event signatures changed.**

Run: `grep -cE '"type":"function"' /Users/utkarsh/Desktop/Projects/Playground/playground-app/target/playground-registry.release.abi.json`
Expected: the previous function count **+2** (only `getLineage` and `getLineageCount` are added). No function was removed or renamed. (For reference, the deployed v11 ABI had 45 functions; the new build should have 47.)

---

## Task 4: On-chain verification against `@staging`

> This task deploys to `@staging/playground-registry` and exercises the lineage path on a real chain. It requires the team dev SURI and a funded signer. **Known caveat** (documented at `scripts/smoke-test-points.ts:29-38`): on the staging dev signer, `publish().tx()` can silently fail after best-block inclusion because the signer's free balance can't cover the storage-deposit reservation. Pass an explicit `storageDepositLimit` in the `.tx()` options (the script below does) or run from a topped-up account. If deploy/funding is blocked, the **build gates in Tasks 1-3 are the hard correctness signal**; flag the deploy to the user/team.

**Files:**
- Create: `/Users/utkarsh/Desktop/Projects/Playground/playground-app/scripts/check-lineage.ts`

- [ ] **Step 1: Deploy the updated contract to `@staging`.**

Per `playground-app/CLAUDE.md` ("Smoke-testing the contract on @staging"):
1. In `lib.rs`, swap the contract annotation `#[pvm::contract(cdm = "@w3s/playground-registry")]` (`lib.rs:547`) to `#[pvm::contract(cdm = "@staging/playground-registry")]`.
2. Run: `cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && rm -f target/playground-registry.* && pnpm build:contracts`
3. Run: `dot contract deploy --signer dev --suri "ensure coffee ripple degree senior grunt unit seek defense year spoon fix"`
4. Note the deployed address from the CLI output.
5. Swap the annotation back to `@w3s/playground-registry`.

- [ ] **Step 2: Write the verification script.**

Create `/Users/utkarsh/Desktop/Projects/Playground/playground-app/scripts/check-lineage.ts` with the standard 14-line Apache header (copy it from the top of `scripts/smoke-test-points.ts:1-14`) followed by:

```ts
/**
 * Verifies on-chain mod-lineage recording on @staging/playground-registry.
 * Publishes a source app, then a child app with modded_from=source, then
 * reads get_lineage and asserts the {child, source} edge is present.
 *
 *   pnpm tsx scripts/check-lineage.ts
 *
 * Set STAGING_ADDR below to the address printed by `dot contract deploy`.
 */
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import {
  ContractManager,
  createContractRuntimeFromClient,
  type CdmJson,
} from "@parity/product-sdk-contracts";
import { seedToAccount } from "@parity/product-sdk-keys";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import cdmJsonRaw from "../cdm.json" with { type: "json" };

const ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";
const DEV_SURI =
  "ensure coffee ripple degree senior grunt unit seek defense year spoon fix";
const PACKAGE = "@staging/playground-registry";
// TODO: set to the address printed by `dot contract deploy` in Step 1.
const STAGING_ADDR = "0x__REPLACE_WITH_DEPLOYED_ADDRESS__";

const VISIBILITY_PUBLIC = 1;
const NO_OWNER = { isSome: false, value: "0x0000000000000000000000000000000000000000" } as const;
const DEPOSIT = { storageDepositLimit: 10_000_000_000_000n } as const; // ample for new entries

async function main() {
  const dev = seedToAccount(DEV_SURI, "");
  const client = createClient(getWsProvider(ASSET_HUB_WS));
  const runtime = createContractRuntimeFromClient(client, paseo_asset_hub);

  // Pin the @staging address rather than resolving via the CDM meta-registry.
  const manifest = structuredClone(cdmJsonRaw) as unknown as CdmJson;
  const targetHash = Object.keys(manifest.targets)[0];
  (manifest.contracts as any)[targetHash][PACKAGE].address = STAGING_ADDR;

  const manager = new ContractManager(manifest, runtime, {
    defaultOrigin: dev.ss58Address,
  });
  const registry = manager.getContract(PACKAGE);

  const run = Date.now().toString(36);
  const source = `lineage-src-${run}.dot`;
  const child = `lineage-child-${run}.dot`;

  console.log(`publishing source ${source} ...`);
  await registry.publish.tx(
    source, "ipfs://meta-source", VISIBILITY_PUBLIC, NO_OWNER, "", false, false,
    { signer: dev.polkadotSigner, waitFor: "finalized", ...DEPOSIT },
  );

  console.log(`publishing child ${child} modded from ${source} ...`);
  await registry.publish.tx(
    child, "ipfs://meta-child", VISIBILITY_PUBLIC, NO_OWNER, source, true, false,
    { signer: dev.polkadotSigner, waitFor: "finalized", ...DEPOSIT },
  );

  const countRes = await registry.getLineageCount.query();
  if (!countRes.success) throw new Error("getLineageCount failed");
  const total = Number(countRes.value);
  console.log(`get_lineage_count = ${total}`);

  const pageRes = await registry.getLineage.query(0, total);
  if (!pageRes.success) throw new Error("getLineage failed");
  const edges = pageRes.value as Array<{ child: string; source: string }>;

  const found = edges.some((e) => e.child === child && e.source === source);
  client.destroy();

  if (!found) {
    console.error("FAIL: expected edge", { child, source }, "not found in", edges);
    process.exit(1);
  }
  console.log("PASS: lineage edge recorded:", { child, source });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

> If the exact `.tx(...)` argument/option shape differs from what your installed `@parity/product-sdk-contracts` expects, mirror the verbatim `registry.publish.tx(...)` call used by the existing scenarios in `scripts/smoke-test-points.ts` (same repo) — that file is the source of truth for the current tx call shape and the `seedToAccount`/signer wiring.

- [ ] **Step 3: Set `STAGING_ADDR` and run the check.**

Edit `STAGING_ADDR` to the address from Task 4 Step 1.4, then run:
`cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && pnpm tsx scripts/check-lineage.ts`
Expected: `PASS: lineage edge recorded: { child: 'lineage-child-...', source: 'lineage-src-...' }`

- [ ] **Step 4: Run the existing points smoke test to confirm no regression.**

Run: `cd /Users/utkarsh/Desktop/Projects/Playground/playground-app && pnpm tsx scripts/smoke-test-points.ts`
Expected: the existing scenarios behave exactly as before (the change is additive; award/dedupe/star/mod-count paths are untouched). Subject to the same storage-deposit caveat noted above.

---

## Task 5: Refresh the consumer ABI (for the display app)

> The display app (`playground-constellation`) reads `get_lineage` via its own `cdm.json`. After the production/Summit deploy, that ABI must be refreshed. This step is for whoever owns the display app's repo; included here so it isn't forgotten.

- [ ] **Step 1: After the real deploy, install the updated ABI in the consumer repo.**

Run (in the display app repo): `dot contract install @w3s/playground-registry`
Expected: the repo's `cdm.json` now includes `getLineage` / `getLineageCount` in the registry ABI. Until this is done, the display app falls back to live-only lineage.

---

## Self-Review

**Spec coverage:** The spec's "Lineage — new on-chain getter" section requires: a `LineageEdge` storage struct (Task 1.1), `lineage_count`/`lineage_at`/`lineage_recorded` fields (Task 2.1), recording in `publish` before the award gating (Task 3.1), `LineageEntry` SolAbi struct (Task 1.2), and `get_lineage_count` + `get_lineage` paged getters (Task 3.2). All covered. Backward-compatibility (no existing item touched) is asserted in Task 3.4.

**Placeholder scan:** The only literal placeholder is `STAGING_ADDR = "0x__REPLACE..."`, which is a genuine deploy-time value the agent fills in Task 4 Step 3 (called out explicitly), not an unspecified implementation detail. All Rust code is complete and copyable.

**Type consistency:** `LineageEdge { child: String, source: String }` (SCALE storage) and `LineageEntry { child: String, source: String }` (SolAbi return) share field names; the getter maps `edge.child → entry.child`, `edge.source → entry.source`. Storage accessors `lineage_count()` / `lineage_at()` / `lineage_recorded()` match the field names `lineage_count` / `lineage_at` / `lineage_recorded`. Method names `get_lineage` / `get_lineage_count` → ABI `getLineage` / `getLineageCount`, matched in the verification script (`registry.getLineage.query`, `registry.getLineageCount.query`).
