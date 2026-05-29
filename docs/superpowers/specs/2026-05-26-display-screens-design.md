# Playground Constellation — Live Event Display Screen

**Date:** 2026-05-26
**Status:** Design approved, pre-implementation
**Project dir:** `playground-constellation/` (formerly `display-screens/`)

## Purpose

A standalone, big-screen web app for the Web3 Summit Developer Lab (Berlin, 18–19 June 2026). It visualizes live activity from the `@w3s/playground-registry` smart contract as a **cosmic constellation** — a force-directed star map of every app, builder, and the mod-lineage between them — paired with a terminal-style event feed. Runs unattended on venue display screens to make the hackathon feel alive.

Design goals: imaginative, eye-catching, immediately legible from a distance, zero interaction required.

## Core decisions (locked)

- **Runs inside Polkadot Desktop as a host container**, on the display machine — exactly like `playground-app`. Not a plain-browser kiosk: all chain access goes through the host and we never open our own socket / escape the host. No sign-in/wallet (read-only; default Alice read origin).
- **Read-only.** Never writes to chain. No backend/server. One static bundle, loaded inside the host.
- **No Bulletin, no People parachain.** Everything rendered (usernames, domains, XP, stars, mods, lineage) comes from the registry contract + its event stream, all queryable over the plain Substrate WS endpoint. Usernames are stored on the registry contract itself (`getUsernames` batch read) — confirmed in the v11 ABI.
- **No app icons.** The cosmic aesthetic uses glowing nodes, not icons — which is what lets us avoid the Bulletin (host-only) dependency.
- **Visual direction:** "Hybrid B" — constellation as the hero on the left ~60%, persistent terminal-style event feed on the right ~38%, with a lower-third headline for the latest event.

## Tech stack

- React 19 + TypeScript + Vite (mirrors `playground-app`).
- `@parity/product-sdk-*` on **paseo-next-v2**, used **completely** — same as `playground-app`.
- **Runs inside Polkadot Desktop as a host container** (launched on the display machine), exactly like `playground-app`. It is *not* a plain-browser kiosk: all chain access routes **through the host** and we never open our own socket. No sign-in (read-only; reads use the default Alice origin like `playground-app`).
- **Host-routed connection.** Use `@parity/product-sdk-chain-client`'s `getChainAPI("paseo")`, which connects via `getHostProvider(genesis)` from `@parity/product-sdk-host` (throws *"Host provider unavailable…"* outside a host). Mirror `playground-app/src/utils/contracts.ts` verbatim: `const client = await getChainAPI(CHAIN)` → `createContractRuntimeFromClient(client.raw.assetHub, paseo_asset_hub)` → `withLiveContractAddresses(cdmJson, runtime)` → `new ContractManager(manifest, runtime, { defaultOrigin })` → `manager.getContract("@w3s/playground-registry")`.
  - Typed PAPI api: `client.assetHub`; raw `PolkadotClient`: `client.raw.assetHub`.
  - Live events: `client.assetHub.event.Revive.ContractEmitted.watch().subscribe(...)`.
  - Historical reads: `client.assetHub.query.System.Events.getValue({ at: blockHash })` — **routed through the host** (see the lineage-scan risk in Open items).
- Read origin for queries: Alice SS58 via `seedToAccount(DEV_PHRASE, "//Alice").ss58Address` (`@parity/product-sdk-keys` + `@polkadot-labs/hdkd-helpers`), same as `playground-app`.
- Live contract address resolved via `withLiveContractAddresses` (on-chain CDM meta-registry) with fallback to the `cdm.json` snapshot — so a fresh summit redeploy is picked up without editing the bundle.
- Pure CSS, dark cosmic theme, Polkadot pink `#e6007a`. Fonts: DM Sans / DM Serif Display (headline) + a monospace (IBM Plex Mono / Menlo) for the feed.
- **Rendering:** HTML5 Canvas (not DOM nodes) driven by a lightweight force-directed layout (`d3-force` or equivalent). Canvas is required to hold 60fps with hundreds of nodes.

## The constellation model

A live force-directed graph. Nodes repel, edges act as springs, so clusters form organically around popular apps. Nothing is hand-placed; layout emerges from the data.

### Node types
- **App nodes** (pink) — every deployed `.dot`. Born on `Published` / `DeployPointAwarded`.
- **Builder nodes** (cyan) — every person, labeled by **username** (`alice.dot`) resolved via `getUsernames`; falls back to a shortened H160 if unset.
- **Pinned roots** (gold) — the tutorial (`rock-paper-scissors`) and sample apps. Brightest/biggest; they anchor the map. Driven by `getPinnedApps` + `Pinned`/`Unpinned`.

### Edge types
1. **Mod lineage** (bright gold→pink arc) — the centerpiece. Drawn source-app → new-app when a mod happens. Over two days this becomes a visible **family tree** of the event. Source comes only from `ModPointAwarded.source_domain` (see Data layer — lineage is **not** stored on-chain).
2. **Ownership** (faint cyan) — builder → app they deployed.
3. **Star** (dashed, transient) — flashes builder → app on `StarPointAwarded`, then fades; starred app swells slightly.

### Node visual encoding
- **Size = XP / importance.** Heavily-modded/starred apps and high-XP builders grow. The leaderboard is encoded spatially, not just in the sidebar.
- **Glow = recency.** Just-touched nodes flare and pulse; idle nodes dim but **never disappear** (this is the persistence story, made visual).
- **Gentle drift** so the field feels alive during quiet stretches; a slow "camera" eases toward recent activity.

### Adaptivity / scale
Target 50–200 nodes, graceful into the hundreds. Labels show only on pinned roots + recently-active + largest nodes; the long tail renders as small dim stars (level-of-detail). No rewrite needed across the range.

## Data layer (three sources)

### 1. Cold-load structure — contract reads (fast, always works)
On launch, batched reads reconstruct every node, ownership edge, and node size:
- `getApps` → all domains
- `getOwner`, `getStarCount`, `getModCount` per app
- `getTopBuilders` / `getPoints` → XP
- `getUsernames` → batch username resolution
- `getPinnedApps` → roots

This resolves in ~1–2s and paints the **entire galaxy at once** — no blank/sparse screen. Does not require any history.

### 2. Lineage — new on-chain getter (the must-have), via an additive contract change
Lineage was **not persisted on-chain** (registry comment: *"no persisted modded_from link"*) — the source→mod link only ever traveled in the live `ModPointAwarded` payload. And the host blocks all historical reads: `createPapiProvider` (`triangle-js-sdks/packages/host-api-wrapper/src/papiProvider.ts`) whitelists only `chainHead_v1_*`, `chainSpec_v1_*`, `transaction_v1_*` — no `archive_*`, no `state_getStorageAt`. So a runtime block-scan is impossible in-host. **Decision: persist lineage on-chain** so cold-load lineage is a plain host-compatible contract read.

**Contract change (additive, backward-compatible — `playground-app/contracts/registry/lib.rs`):**
- New SCALE storage struct `LineageEdge { child: String, source: String }`; new fields `lineage_count: u32`, `lineage_at: Mapping<u32, LineageEdge>`, `lineage_recorded: Mapping<String, bool>`.
- In `publish`, after the `is_new_app` guard and **before** the existing award gating, record the edge once for any genuinely-new app whose non-empty `modded_from` source exists — independent of the XP award/dedupe/dev-signer path, so the visual tree is complete. Re-publishes never reach here (`is_new_app` guard); `lineage_recorded[child]` dedupes.
- New SolAbi return struct `LineageEntry { child: String, source: String }`; new read methods `get_lineage_count() -> u32` and `get_lineage(start: u32, count: u32) -> Vec<LineageEntry>` (paged, mirrors `get_apps`/`AppsPage`).
- **No existing method, struct, event, or storage field is touched** → `playground-app` and `playground-cli` are unaffected. Build (`pnpm build:contracts`), regression (`scripts/smoke-test-points.ts`), deploy to `@staging` for testing, then the Summit deploy carries it.

**App side:** on cold load, page `get_lineage(start, count)` (host-compatible best/finalized read) to get every edge → draw all lineage arcs. The live `ModPointAwarded` subscription extends the tree going forward (it also fires whenever a new edge is recorded). No archive, no block scan, no `START_BLOCK`.

**Dependency:** the app's `get_lineage` read requires the updated contract deployed and its ABI present in the app's `cdm.json` (refreshed via `cdm install` after deploy). Until then the app degrades to live-only lineage. Coordinate the contract deploy (needs the team's dev SURI) before relying on cold-load lineage.

### 3. Live events — subscription (animation + ongoing lineage)
After the scan, subscribe to `client.assetHub.event.Revive.ContractEmitted.watch()` (same mechanism as `playground-app/src/App.tsx`). Each event animates the constellation, appends a sidebar row, and swaps the headline. `ModPointAwarded` extends the lineage tree live.

### localStorage cache (persistence)
Persists the accumulated graph (nodes, ownership, sizes, lineage) + last ~50 events. A refresh or brief network drop restores instantly; the tree survives.

## Loading choreography (no blank screen, visible progress)
1. **T+0:** cosmic background; if a cached graph exists, restore it instantly.
2. **T+~1–2s:** batched contract reads resolve (`getApps` pages + owners + counts + `getUsernames` + `getPinnedApps` + **`getLineage` pages**) → full galaxy of nodes, ownership edges, **and gold lineage arcs** materializes, sized by XP. Screen is fully alive *with the family tree* in one shot. A subtle progress meter covers the paging (`loading… 6 / 9 pages`); arcs can animate in for delight but the data is all present.
3. **Then:** flip to the live `Revive.ContractEmitted.watch()` subscription; progress UI fades, LIVE indicator goes solid.
4. Live events animate as designed and extend the tree.

## Event → visual mapping

| Contract event | Reaction |
|---|---|
| `Published` / `DeployPointAwarded` / `PlaygroundPublishPointAwarded` | Birth a new app node with an expanding ring near its owner |
| `ModPointAwarded` | Draw a gold lineage arc source → new app; both pulse |
| `ModdablePointAwarded` | Mark app as moddable (subtle ring) |
| `StarPointAwarded` | Transient dashed thread builder → app; app node swells |
| `StarPointRefunded` | Reverse: thread fades, node shrinks slightly |
| `Pinned` / `Unpinned` | Node turns gold (root) / reverts |
| `Unpublished` | Node dims to a faint ghost (kept, not deleted) |
| `Rated` / `RatingRemoved` / `VisibilityChanged` | Minor pulse, sidebar line only |

**Dedup rule:** one user action emits several events (a deploy fires `Published` + `DeployPointAwarded` + `PlaygroundPublishPointAwarded`; a mod also fires `Published` + `DeployPointAwarded` + `ModPointAwarded`). Collapse events sharing a tx/block+domain into **one logical event**, with `ModPointAwarded` outranking a plain deploy, so one action = one pulse + one sidebar row.

Event topics: `topic[0] = keccak256(eventName)`; legacy events carry raw UTF-8 domain bytes, typed point events carry SCALE-encoded payloads (`PointAwardEvent`, `ModPointEvent`, `StarPointEvent`). Reuse `playground-app/src/scaleDecode.ts` decode logic.

## Text layer (sidebar + headline)
- **Right ~38%:** persistent terminal-style feed, ~6–8 rows, newest slides in on top, human-readable (`alice.dot ⇢ the-ballot.dot +25`). Color coding: `[EVENT]` yellow, username pink, domain white, XP green, timestamp dim green.
- **Lower-third headline:** latest event large (serif, distance-legible), lingers a few seconds.
- **Top strip:** event title + LIVE indicator + running totals (apps live, stars given, XP awarded).

## Components (rough)
- `App.tsx` — orchestrator: client setup, load sequence, state.
- `chain/` — `contractReads.ts` (cold-load structure + `getLineage` paging), `liveEvents.ts` (subscription), `decode.ts` (port of scaleDecode), `cache.ts` (localStorage).
- `graph/` — `forceLayout.ts` (d3-force sim), `ConstellationCanvas.tsx` (render loop), `eventChoreography.ts` (event → animation), `dedup.ts`.
- `ui/` — `EventFeed.tsx`, `Headline.tsx`, `TopStrip.tsx`, `LoadingProgress.tsx`.
- `model/` — graph types, event types, username resolution.

Keep pure logic in `.ts` files (testable without React), per the playground repo convention.

## Out of scope (V1)
- Sign-in / wallet / writes to chain.
- Bulletin, People parachain, app icons.
- Backend/server, any indexer.
- Trending-apps panel (nice-to-have, not mandatory — may add later).
- Multi-screen orchestration (design for single 16:9 landscape, adaptable).

## Open items / risks
- **Contract deploy coordination.** The lineage getter requires deploying the modified registry. The registry is shared (`playground-app` + `playground-cli`); the change is additive/backward-compatible but still needs team sign-off and the dev SURI to deploy (test on `@staging` first, then the Summit deploy). I do not have the SURI — flag for the user/team.
- **Lineage is captured only for mods published after the contract change.** Acceptable: the Summit runs on a fresh deploy, so all event mods are captured. On the current `@w3s` deployment, pre-change mods have no edge.
- **`cdm.json` ABI refresh.** After deploy, run `cdm install @w3s/playground-registry` in the constellation repo so `get_lineage` is in the ABI; until then the app falls back to live-only lineage.
- **Host = live window only.** All reads must be best/finalized contract `.query()` or live `chainHead` subscription — never a historical-`at` read (host returns `-32601`). Contract getters satisfy this.
- **Summit devnet is a separate deployment** — endpoints/contract address live in config; do not hardcode paseo-next-v2 as permanent.
